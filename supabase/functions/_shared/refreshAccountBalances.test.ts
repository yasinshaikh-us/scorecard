import { describe, it, expect, vi } from "vitest";
import { refreshAccountBalances } from "./refreshAccountBalances.ts";

// refreshAccountBalances takes its Supabase and Plaid clients as
// arguments and imports them only as *types*, so it can be exercised
// under Node with fakes -- no Deno runtime, no network, no real project.
//
// The behavior most worth pinning is the tracked-account filter. Plaid's
// Balance product returns every account on the Item, including ones
// plaid-exchange deliberately declined to track as duplicates of an
// already-linked account. plaid_account_balances.account_id has a foreign
// key into plaid_accounts, so upserting an untracked account's balance
// fails the WHOLE batch -- one stray account silently kills the balance
// refresh for every account the user does have.

function balancesFor(accounts: Array<{ id: string; available?: number | null; current?: number | null; currency?: string | null }>) {
  return {
    data: {
      // `in` rather than `??` so an explicitly-null balance stays null --
      // Plaid really does send null `available` for credit accounts, and a
      // fixture that quietly turned it into a number would make the
      // null-passthrough test below vacuous.
      accounts: accounts.map((a) => ({
        account_id: a.id,
        balances: {
          available: "available" in a ? a.available : 100,
          current: "current" in a ? a.current : 200,
          iso_currency_code: "currency" in a ? a.currency : "USD",
        },
      })),
    },
  };
}

// Minimal stand-in for the PostgREST builder chain the function uses:
//   db.from("plaid_accounts").select("account_id").in("account_id", ids)
//   db.from("plaid_account_balances").upsert(rows, { onConflict })
function fakeDb({ tracked = [] as string[], trackedError = null as unknown, upsertError = null as unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const inFn = vi.fn().mockResolvedValue({
    data: trackedError ? null : tracked.map((account_id) => ({ account_id })),
    error: trackedError,
  });
  const from = vi.fn((table: string) => {
    if (table === "plaid_accounts") return { select: () => ({ in: inFn }) };
    if (table === "plaid_account_balances") return { upsert };
    throw new Error(`unexpected table: ${table}`);
  });
  return { db: { from } as never, upsert, inFn, from };
}

function fakeClient(response: ReturnType<typeof balancesFor>) {
  const accountsBalanceGet = vi.fn().mockResolvedValue(response);
  return { client: { accountsBalanceGet } as never, accountsBalanceGet };
}

const ITEM = { user_id: "user-1", access_token: "access-token-1" };

describe("refreshAccountBalances", () => {
  it("upserts a balance row for each tracked account", async () => {
    const { db, upsert } = fakeDb({ tracked: ["acct-1", "acct-2"] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }, { id: "acct-2" }]));

    const count = await refreshAccountBalances(db, client, ITEM);

    expect(count).toBe(2);
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(options).toEqual({ onConflict: "account_id" });
  });

  it("skips accounts Plaid returned that are not tracked in plaid_accounts", async () => {
    // acct-2 is a duplicate plaid-exchange chose not to track. Including
    // it would violate the foreign key and fail the entire upsert.
    const { db, upsert } = fakeDb({ tracked: ["acct-1"] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }, { id: "acct-2" }]));

    const count = await refreshAccountBalances(db, client, ITEM);

    expect(count).toBe(1);
    expect(upsert.mock.calls[0][0].map((r: { account_id: string }) => r.account_id)).toEqual(["acct-1"]);
  });

  it("does not call upsert at all when no returned account is tracked", async () => {
    const { db, upsert } = fakeDb({ tracked: [] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await expect(refreshAccountBalances(db, client, ITEM)).resolves.toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("handles Plaid returning no accounts at all", async () => {
    const { db, upsert } = fakeDb({ tracked: ["acct-1"] });
    const { client } = fakeClient(balancesFor([]));

    await expect(refreshAccountBalances(db, client, ITEM)).resolves.toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("carries the item's user_id onto every row, not the account's", async () => {
    // plaid_account_balances is RLS-scoped on user_id; getting this wrong
    // would write another user's balances under the wrong owner.
    const { db, upsert } = fakeDb({ tracked: ["acct-1"] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await refreshAccountBalances(db, client, ITEM);

    expect(upsert.mock.calls[0][0][0].user_id).toBe("user-1");
  });

  it("copies the balance fields through verbatim, including nulls", async () => {
    // Plaid legitimately returns null `available` for some account types
    // (credit cards in particular) -- that must land as null, not 0.
    const { db, upsert } = fakeDb({ tracked: ["acct-1"] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1", available: null, current: 1234.56, currency: "CAD" }]));

    await refreshAccountBalances(db, client, ITEM);

    const row = upsert.mock.calls[0][0][0];
    expect(row.available).toBeNull();
    expect(row.current).toBe(1234.56);
    expect(row.iso_currency_code).toBe("CAD");
  });

  it("stamps as_of with a valid ISO timestamp", async () => {
    const { db, upsert } = fakeDb({ tracked: ["acct-1"] });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await refreshAccountBalances(db, client, ITEM);

    const { as_of } = upsert.mock.calls[0][0][0];
    expect(Number.isNaN(Date.parse(as_of))).toBe(false);
  });

  it("requests balances for the item's own access token", async () => {
    const { db } = fakeDb({ tracked: ["acct-1"] });
    const { client, accountsBalanceGet } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await refreshAccountBalances(db, client, ITEM);

    expect(accountsBalanceGet).toHaveBeenCalledWith({ access_token: "access-token-1" });
  });

  it("throws when the tracked-accounts lookup fails", async () => {
    const { db } = fakeDb({ trackedError: new Error("lookup failed") });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await expect(refreshAccountBalances(db, client, ITEM)).rejects.toThrow("lookup failed");
  });

  it("throws when the upsert fails, rather than reporting a false success", async () => {
    const { db } = fakeDb({ tracked: ["acct-1"], upsertError: new Error("upsert failed") });
    const { client } = fakeClient(balancesFor([{ id: "acct-1" }]));

    await expect(refreshAccountBalances(db, client, ITEM)).rejects.toThrow("upsert failed");
  });
});
