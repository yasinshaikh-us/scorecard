import { describe, it, expect, vi, beforeEach } from "vitest";

// The Plaid ingest path: every transaction that reaches a user's ledger
// from a linked bank goes through this function. It was the largest
// untested file in the backend (~240 lines) purely because it constructed
// its own Deno-only clients; with those injected (see the file header) it
// is ordinary testable code.
//
// The behaviors here are the ones that corrupt a ledger silently rather
// than failing loudly: the amount sign flip, the duplicate-account filter,
// the manually-edited guard, and the relink boundary dedup. None of them
// raise an error when they go wrong -- they just produce a wrong ledger.

// Isolated so this file tests the sync path, not the balance refresh
// (which has its own tests). Mocking it also makes the "best-effort"
// contract directly assertable: a balance failure must not fail the sync.
const refreshAccountBalances = vi.fn();
vi.mock("./refreshAccountBalances.ts", () => ({
  refreshAccountBalances: (...args: unknown[]) => refreshAccountBalances(...args),
}));

const { syncItemTransactions } = await import("./syncItemTransactions.ts");

const ITEM = {
  id: "item-row-1",
  user_id: "user-1",
  access_token: "access-token-1",
  cursor: "cursor-0",
};

type Result = { data?: unknown; error?: unknown; count?: number };

interface DbConfig {
  item?: Result;
  rules?: Result;
  accountCount?: Result;
  tracked?: Result;
  manuallyEdited?: Result;
  boundaryExisting?: Result;
  upsert?: Result;
  delete?: Result;
  cursorUpdate?: Result;
}

// A stand-in for the PostgREST builder. Every method returns `this` so
// chains work, and the object is thenable so `await db.from(...)...` calls
// resolve. Which configured result a chain gets is decided from the table
// plus the select arguments -- the same way the real queries differ.
function fakeDb(config: DbConfig = {}) {
  const calls = {
    upserts: [] as unknown[][],
    deletes: [] as unknown[][],
    cursorUpdates: [] as unknown[][],
    // Every `.in(...)` filter, recorded per table/op, so the chunking of
    // Plaid-sized batches is directly assertable.
    selectIns: [] as { table: string; column: string; values: unknown[] }[],
  };

  function query(table: string) {
    const state: { op: string; columns: string; head: boolean } = { op: "select", columns: "", head: false };

    const resolve = (): Result => {
      if (state.op === "upsert") return config.upsert ?? { error: null };
      if (state.op === "delete") return config.delete ?? { error: null };
      if (state.op === "update") return config.cursorUpdate ?? { error: null };
      if (table === "plaid_items") return config.item ?? { data: ITEM, error: null };
      if (table === "category_rules") return config.rules ?? { data: [], error: null };
      if (table === "plaid_accounts") {
        return state.head
          ? (config.accountCount ?? { count: 1, error: null })
          : (config.tracked ?? { data: [], error: null });
      }
      if (table === "transactions") {
        return state.columns.includes("plaid_transaction_id")
          ? (config.manuallyEdited ?? { data: [], error: null })
          : (config.boundaryExisting ?? { data: [], error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    };

    const builder: Record<string, unknown> = {
      select(columns: string, options?: { head?: boolean }) {
        state.columns = columns ?? "";
        state.head = Boolean(options?.head);
        return builder;
      },
      upsert(rows: unknown, options: unknown) {
        state.op = "upsert";
        calls.upserts.push([rows, options]);
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      update(patch: unknown) {
        state.op = "update";
        calls.cursorUpdates.push([patch]);
        return builder;
      },
      eq: () => builder,
      order: () => builder,
      in(column: string, values: unknown) {
        if (state.op === "delete") calls.deletes.push([column, values]);
        else calls.selectIns.push({ table, column, values: values as unknown[] });
        return builder;
      },
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return builder;
  }

  return { db: { from: (table: string) => query(table) } as never, calls };
}

function tx(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: "tx-1",
    account_id: "acct-1",
    date: "2026-01-15",
    amount: 12.34,
    merchant_name: "Blue Bottle",
    name: "BLUE BOTTLE COFFEE",
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
    ...overrides,
  };
}

// One page of Plaid's /transactions/sync response.
function page(over: Partial<{ added: unknown[]; modified: unknown[]; removed: unknown[]; has_more: boolean; next_cursor: string }> = {}) {
  return {
    data: {
      added: over.added ?? [],
      modified: over.modified ?? [],
      removed: over.removed ?? [],
      has_more: over.has_more ?? false,
      next_cursor: over.next_cursor ?? "cursor-1",
    },
  };
}

function fakeClient(pages: ReturnType<typeof page>[]) {
  const transactionsSync = vi.fn();
  for (const p of pages) transactionsSync.mockResolvedValueOnce(p);
  return { client: { transactionsSync } as never, transactionsSync };
}

// The default happy path: one tracked account, one added transaction.
function happyPath(config: DbConfig = {}, added = [tx()]) {
  const { db, calls } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null }, ...config });
  const { client, transactionsSync } = fakeClient([page({ added })]);
  return { db, calls, client, transactionsSync };
}

function upsertedRows(calls: ReturnType<typeof fakeDb>["calls"]) {
  return (calls.upserts[0]?.[0] ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshAccountBalances.mockResolvedValue(0);
});

describe("syncItemTransactions", () => {
  describe("item lookup", () => {
    it("no-ops instead of throwing for an unknown item", async () => {
      // Plaid keeps retrying a webhook that errors. A disconnected Item can
      // still have webhooks in flight, and those can never succeed -- so
      // this must be a no-op, not an error, or Plaid retries forever.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { db } = fakeDb({ item: { data: null, error: null } });
      const { client } = fakeClient([]);

      await expect(syncItemTransactions("gone", client, db)).resolves.toEqual({
        added: 0, modified: 0, removed: 0, skipped: true,
      });
      warn.mockRestore();
    });

    it("throws with the item id when the lookup itself fails", async () => {
      const { db } = fakeDb({ item: { data: null, error: { message: "boom" } } });
      const { client } = fakeClient([]);

      await expect(syncItemTransactions("item-x", client, db))
        .rejects.toThrow("Failed to look up plaid_items row for item_id=item-x: boom");
    });
  });

  describe("cursor pagination", () => {
    it("keeps requesting while has_more, accumulating every page", async () => {
      const { db, calls } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null } });
      const { client, transactionsSync } = fakeClient([
        page({ added: [tx({ transaction_id: "tx-1" })], has_more: true, next_cursor: "cursor-1" }),
        page({ added: [tx({ transaction_id: "tx-2" })], has_more: true, next_cursor: "cursor-2" }),
        page({ added: [tx({ transaction_id: "tx-3" })], has_more: false, next_cursor: "cursor-3" }),
      ]);

      const result = await syncItemTransactions("item-1", client, db);

      expect(transactionsSync).toHaveBeenCalledTimes(3);
      expect(result.added).toBe(3);
      expect(upsertedRows(calls)).toHaveLength(3);
    });

    it("starts from the item's stored cursor and advances it on each page", async () => {
      const { db } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null } });
      const { client, transactionsSync } = fakeClient([
        page({ has_more: true, next_cursor: "cursor-1" }),
        page({ has_more: false, next_cursor: "cursor-2" }),
      ]);

      await syncItemTransactions("item-1", client, db);

      expect(transactionsSync.mock.calls[0][0]).toEqual({ access_token: "access-token-1", cursor: "cursor-0" });
      expect(transactionsSync.mock.calls[1][0]).toEqual({ access_token: "access-token-1", cursor: "cursor-1" });
    });

    it("sends undefined rather than null for an item that has never synced", async () => {
      // Plaid treats a missing cursor as "full historical sync"; passing an
      // explicit null is not the same thing to its client library.
      const { db } = fakeDb({ item: { data: { ...ITEM, cursor: null }, error: null } });
      const { client, transactionsSync } = fakeClient([page()]);

      await syncItemTransactions("item-1", client, db);

      expect(transactionsSync.mock.calls[0][0].cursor).toBeUndefined();
    });

    it("persists the final cursor after a successful sync", async () => {
      const { db, calls } = fakeDb();
      const { client } = fakeClient([page({ has_more: true, next_cursor: "cursor-1" }), page({ next_cursor: "cursor-final" })]);

      await syncItemTransactions("item-1", client, db);

      expect((calls.cursorUpdates[0][0] as { cursor: string }).cursor).toBe("cursor-final");
    });
  });

  describe("the amount sign flip", () => {
    // Plaid: positive = money OUT. This app: negative = money out. Getting
    // this backwards turns every expense into income and vice versa, with
    // no error anywhere -- the single highest-blast-radius line in the file.
    it("negates a Plaid positive (spend) into a stored negative", async () => {
      const { db, calls, client } = happyPath({}, [tx({ amount: 12.34 })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].amount).toBe(-12.34);
    });

    it("negates a Plaid negative (deposit) into a stored positive", async () => {
      const { db, calls, client } = happyPath({}, [tx({ amount: -1500 })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].amount).toBe(1500);
    });
  });

  describe("payee and category derivation", () => {
    it("prefers merchant_name over the raw descriptor", async () => {
      const { db, calls, client } = happyPath({}, [tx({ merchant_name: "Blue Bottle", name: "SQ BLUE BOTTLE" })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_payee).toBe("Blue Bottle");
    });

    it("falls back to the raw descriptor when there is no merchant_name", async () => {
      const { db, calls, client } = happyPath({}, [tx({ merchant_name: null, name: "SQ BLUE BOTTLE" })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_payee).toBe("SQ BLUE BOTTLE");
    });

    it("falls back to Unknown when Plaid supplies neither", async () => {
      const { db, calls, client } = happyPath({}, [tx({ merchant_name: null, name: null })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_payee).toBe("Unknown");
    });

    it("prefers personal_finance_category.primary", async () => {
      const { db, calls, client } = happyPath({}, [tx({ personal_finance_category: { primary: "FOOD_AND_DRINK" } })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_category).toBe("FOOD_AND_DRINK");
    });

    it("falls back to the legacy category array, joined", async () => {
      const { db, calls, client } = happyPath({}, [
        tx({ personal_finance_category: null, category: ["Food and Drink", "Coffee Shop"] }),
      ]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_category).toBe("Food and Drink > Coffee Shop");
    });

    it("falls back to Uncategorized when Plaid supplies neither", async () => {
      const { db, calls, client } = happyPath({}, [tx({ personal_finance_category: null, category: null })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].raw_category).toBe("Uncategorized");
    });

    it("stores the raw values alongside the rule-processed ones", async () => {
      // raw_payee/raw_category are what rules re-match against on every
      // retroactive re-apply, so they must survive untouched.
      const { db, calls, client } = happyPath({}, [tx({ merchant_name: "BLUE BOTTLE COFFEE" })]);
      await syncItemTransactions("item-1", client, db);
      const row = upsertedRows(calls)[0];
      expect(row.raw_payee).toBe("BLUE BOTTLE COFFEE");
      expect(row.payee).toBe("Blue Bottle Coffee");
    });
  });

  describe("category rules", () => {
    it("applies the user's enabled rules to each transaction", async () => {
      const { db, calls, client } = happyPath({
        rules: { data: [{ match_field: "payee", match_value: "bottle", set_category: "Groceries", set_payee: null }], error: null },
      }, [tx({ merchant_name: "BLUE BOTTLE COFFEE" })]);

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls)[0].category).toBe("Groceries");
    });

    it("clamps an unmatched Plaid category into the closed set", async () => {
      const { db, calls, client } = happyPath({}, [tx({ personal_finance_category: { primary: "FOOD_AND_DRINK" } })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].category).toBe("Miscellaneous");
    });
  });

  describe("is_transfer", () => {
    it("marks a TRANSFER_OUT as a transfer once 2+ accounts are linked", async () => {
      const { db, calls, client } = happyPath({
        accountCount: { count: 2, error: null },
      }, [tx({ personal_finance_category: { primary: "TRANSFER_OUT" } })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].is_transfer).toBe(true);
    });

    it("does NOT mark a transfer when only one account is linked", async () => {
      // With one tracked account there is no second account for the money
      // to land in, so nothing can be double-counted -- and treating a
      // mortgage or alimony payment as a transfer would make it vanish
      // from spending totals entirely.
      const { db, calls, client } = happyPath({
        accountCount: { count: 1, error: null },
      }, [tx({ personal_finance_category: { primary: "TRANSFER_OUT" } })]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].is_transfer).toBe(false);
    });

    it("leaves ordinary spending unmarked even with many accounts linked", async () => {
      const { db, calls, client } = happyPath({ accountCount: { count: 5, error: null } }, [tx()]);
      await syncItemTransactions("item-1", client, db);
      expect(upsertedRows(calls)[0].is_transfer).toBe(false);
    });
  });

  describe("untracked-account filter", () => {
    it("drops transactions for accounts plaid-exchange chose not to track", async () => {
      // Those accounts were skipped at link time as duplicates of an
      // already-linked real account. Ingesting their transactions here
      // recreates the duplicate-ledger bug through the sync path.
      const { db, calls } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null } });
      const { client } = fakeClient([page({
        added: [tx({ transaction_id: "keep", account_id: "acct-1" }), tx({ transaction_id: "drop", account_id: "acct-untracked" })],
      })]);

      await syncItemTransactions("item-1", client, db);

      const rows = upsertedRows(calls);
      expect(rows).toHaveLength(1);
      expect(rows[0].plaid_transaction_id).toBe("keep");
    });

    it("upserts nothing at all when no account is tracked", async () => {
      const { db, calls } = fakeDb({ tracked: { data: [], error: null } });
      const { client } = fakeClient([page({ added: [tx()] })]);

      const result = await syncItemTransactions("item-1", client, db);

      expect(calls.upserts).toHaveLength(0);
      // Still reports what Plaid sent, not what was written.
      expect(result.added).toBe(1);
    });
  });

  describe("manually-edited guard", () => {
    it("skips a transaction the user has edited by hand", async () => {
      // Plaid re-reports the same transaction on a pending -> posted
      // transition. Without this, that overwrites the user's own edit.
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null },
        manuallyEdited: { data: [{ plaid_transaction_id: "tx-edited" }], error: null },
      });
      const { client } = fakeClient([page({
        added: [tx({ transaction_id: "tx-edited" }), tx({ transaction_id: "tx-fresh" })],
      })]);

      await syncItemTransactions("item-1", client, db);

      const rows = upsertedRows(calls);
      expect(rows).toHaveLength(1);
      expect(rows[0].plaid_transaction_id).toBe("tx-fresh");
    });
  });

  describe("relink boundary (resync_after_date)", () => {
    it("drops transactions from before the boundary date", async () => {
      // A relinked account replays its whole history. Everything up to the
      // boundary is already in the ledger.
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
      });
      const { client } = fakeClient([page({
        added: [
          tx({ transaction_id: "old", date: "2026-01-10" }),
          tx({ transaction_id: "new", date: "2026-01-20" }),
        ],
      })]);

      await syncItemTransactions("item-1", client, db);

      const rows = upsertedRows(calls);
      expect(rows.map((r) => r.plaid_transaction_id)).toEqual(["new"]);
    });

    it("keeps a boundary-date transaction that is genuinely new", async () => {
      // The boundary date is included (>=) because Plaid dates have no
      // time component: something can post later the same day, after the
      // disconnect, and would otherwise be dropped forever.
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
        boundaryExisting: { data: [], error: null },
      });
      const { client } = fakeClient([page({ added: [tx({ transaction_id: "same-day", date: "2026-01-15", amount: 40 })] })]);

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls).map((r) => r.plaid_transaction_id)).toEqual(["same-day"]);
    });

    it("drops a boundary-date transaction that matches one already stored", async () => {
      // Matched on date + amount, against the STORED (negated) amount.
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
        boundaryExisting: { data: [{ date: "2026-01-15", amount: -40 }], error: null },
      });
      const { client } = fakeClient([page({ added: [tx({ transaction_id: "dupe", date: "2026-01-15", amount: 40 })] })]);

      await syncItemTransactions("item-1", client, db);

      expect(calls.upserts).toHaveLength(0);
    });

    it("consumes one stored match per incoming transaction, not all of them", async () => {
      // Two genuine same-day, same-amount transactions must not collapse
      // into one: with a single stored match, exactly one is dropped.
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
        boundaryExisting: { data: [{ date: "2026-01-15", amount: -40 }], error: null },
      });
      const { client } = fakeClient([page({
        added: [
          tx({ transaction_id: "dupe", date: "2026-01-15", amount: 40 }),
          tx({ transaction_id: "genuine-second", date: "2026-01-15", amount: 40 }),
        ],
      })]);

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls).map((r) => r.plaid_transaction_id)).toEqual(["genuine-second"]);
    });

    it("applies the boundary per account, not globally", async () => {
      const { db, calls } = fakeDb({
        tracked: {
          data: [
            { account_id: "acct-relinked", resync_after_date: "2026-01-15" },
            { account_id: "acct-fresh", resync_after_date: null },
          ],
          error: null,
        },
      });
      const { client } = fakeClient([page({
        added: [
          tx({ transaction_id: "relinked-old", account_id: "acct-relinked", date: "2026-01-01" }),
          tx({ transaction_id: "fresh-old", account_id: "acct-fresh", date: "2026-01-01" }),
        ],
      })]);

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls).map((r) => r.plaid_transaction_id)).toEqual(["fresh-old"]);
    });
  });

  describe("removed transactions", () => {
    it("deletes transactions Plaid reports as removed", async () => {
      const { db, calls } = fakeDb();
      const { client } = fakeClient([page({ removed: [{ transaction_id: "gone-1" }, { transaction_id: "gone-2" }] })]);

      const result = await syncItemTransactions("item-1", client, db);

      expect(calls.deletes[0]).toEqual(["plaid_transaction_id", ["gone-1", "gone-2"]]);
      expect(result.removed).toBe(2);
    });

    it("issues no delete when nothing was removed", async () => {
      const { db, calls } = fakeDb();
      const { client } = fakeClient([page()]);
      await syncItemTransactions("item-1", client, db);
      expect(calls.deletes).toHaveLength(0);
    });
  });

  describe("upsert shape", () => {
    it("upserts on plaid_transaction_id so re-processing is idempotent", async () => {
      const { db, calls, client } = happyPath();
      await syncItemTransactions("item-1", client, db);
      expect(calls.upserts[0][1]).toEqual({ onConflict: "plaid_transaction_id" });
    });

    it("stamps the item's owner and marks the row as plaid-sourced", async () => {
      const { db, calls, client } = happyPath();
      await syncItemTransactions("item-1", client, db);
      const row = upsertedRows(calls)[0];
      expect(row.user_id).toBe("user-1");
      expect(row.source).toBe("plaid");
      expect(row.plaid_account_id).toBe("acct-1");
    });
  });

  describe("balance refresh is best-effort", () => {
    it("refreshes balances after a successful sync", async () => {
      const { db, client } = happyPath();
      await syncItemTransactions("item-1", client, db);
      expect(refreshAccountBalances).toHaveBeenCalledTimes(1);
    });

    it("still succeeds when the balance refresh throws", async () => {
      // A balance failure must not fail an already-successful transaction
      // sync, or Plaid retries a webhook whose real work already landed.
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      refreshAccountBalances.mockRejectedValue(new Error("balance boom"));
      const { db, client } = happyPath();

      await expect(syncItemTransactions("item-1", client, db)).resolves.toMatchObject({ added: 1 });
      error.mockRestore();
    });
  });

  describe("error propagation", () => {
    it.each([
      ["rules", { rules: { data: null, error: new Error("rules failed") } }, "rules failed"],
      ["account count", { accountCount: { count: null, error: new Error("count failed") } }, "count failed"],
      ["tracked accounts", { tracked: { data: null, error: new Error("tracked failed") } }, "tracked failed"],
      ["manually-edited lookup", { manuallyEdited: { data: null, error: new Error("edited failed") } }, "edited failed"],
      ["upsert", { upsert: { error: new Error("upsert failed") } }, "upsert failed"],
      ["cursor update", { cursorUpdate: { error: new Error("cursor failed") } }, "cursor failed"],
    ])("propagates a %s failure instead of reporting success", async (_label, config, message) => {
      const { db } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null }, ...(config as DbConfig) });
      const { client } = fakeClient([page({ added: [tx()] })]);

      await expect(syncItemTransactions("item-1", client, db)).rejects.toThrow(message);
    });
  });

  // supabase-js resolves a query as { data: null, error: null } when a
  // filter matches nothing, so every read here is written as `data || []`.
  // If one of those fallbacks were dropped the sync would throw on an
  // ordinary empty result -- a crash on the most common case there is.
  describe("empty reads (data: null with no error)", () => {
    it("treats no tracked accounts as nothing to ingest", async () => {
      const { db, calls } = fakeDb({ tracked: { data: null, error: null } });
      const { client } = fakeClient([page({ added: [tx()] })]);

      await expect(syncItemTransactions("item-1", client, db)).resolves.toMatchObject({ added: 1 });
      // Reported as added by Plaid, but nothing tracked to attribute it to.
      expect(calls.upserts).toHaveLength(0);
    });

    it("treats no manually-edited rows as nothing to protect", async () => {
      const { db, calls, client } = happyPath({ manuallyEdited: { data: null, error: null } });

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls)).toHaveLength(1);
    });

    it("treats no category rules as an empty rule set", async () => {
      const { db, calls, client } = happyPath({ rules: { data: null, error: null } });

      await syncItemTransactions("item-1", client, db);

      // Identical to an explicitly empty rule set: the payee is kept and the
      // Plaid category is clamped into the closed set.
      expect(upsertedRows(calls)[0]).toMatchObject({ payee: "Blue Bottle", category: "Miscellaneous" });
    });

    it("counts a transfer as real spend when the linked-account count is unknown", async () => {
      // is_transfer only suppresses double-counting between two *tracked*
      // accounts. With no usable count, the safe reading is 0 -- excluding
      // it instead would make the money silently disappear from totals.
      const { db, calls, client } = happyPath(
        { accountCount: { count: null, error: null } },
        [tx({ personal_finance_category: { primary: "TRANSFER_OUT" } })]
      );

      await syncItemTransactions("item-1", client, db);

      expect(upsertedRows(calls)[0]).toMatchObject({ is_transfer: false });
    });

    it("treats an empty boundary-date read as nothing already synced", async () => {
      const { db, calls } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
        boundaryExisting: { data: null, error: null },
      });
      const { client } = fakeClient([page({ added: [tx({ date: "2026-01-15" })] })]);

      await syncItemTransactions("item-1", client, db);

      // Nothing on the boundary date to dedup against, so the transaction
      // is new and must be kept rather than dropped.
      expect(upsertedRows(calls)).toHaveLength(1);
    });
  });

  describe("error propagation on the relink and delete paths", () => {
    it("propagates a boundary-date lookup failure instead of reporting success", async () => {
      const { db } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: "2026-01-15" }], error: null },
        boundaryExisting: { data: null, error: new Error("boundary failed") },
      });
      const { client } = fakeClient([page({ added: [tx({ date: "2026-01-15" })] })]);

      await expect(syncItemTransactions("item-1", client, db)).rejects.toThrow("boundary failed");
    });

    it("propagates a delete failure instead of reporting success", async () => {
      // A swallowed delete failure leaves a transaction Plaid has removed
      // sitting in the ledger forever, silently skewing every total.
      const { db } = fakeDb({
        tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null },
        delete: { error: new Error("delete failed") },
      });
      const { client } = fakeClient([page({ removed: [{ transaction_id: "tx-gone" }] })]);

      await expect(syncItemTransactions("item-1", client, db)).rejects.toThrow("delete failed");
    });
  });

  // Regression: a Plaid HISTORICAL_UPDATE hands over an account's entire
  // backlog in one response. Every id-list query built from that batch used
  // to go out as a single `.in(...)`, which PostgREST serializes into the
  // query string -- 246 transactions produced a 9.9KB URL that Deno's fetch
  // rejected with "TypeError: Invalid URL". Because the cursor only advances
  // after every write succeeds, the throw left the cursor unmoved and the
  // next webhook rebuilt the identical oversized URL: ingest wedged
  // permanently on the first oversized batch and never recovered on its own.
  describe("oversized Plaid batches are chunked", () => {
    const MAX_IDS_PER_QUERY = 75;

    function manyTxs(n: number, prefix = "tx") {
      return Array.from({ length: n }, (_, i) =>
        tx({ transaction_id: `${prefix}-${i}`, date: "2026-01-15" })
      );
    }

    function idsIn(calls: ReturnType<typeof fakeDb>["calls"], table: string, column: string) {
      return calls.selectIns.filter((c) => c.table === table && c.column === column);
    }

    it("splits the manually-edited lookup into bounded chunks covering every id", async () => {
      const added = manyTxs(246);
      const { db, calls, client } = happyPath({}, added);

      await syncItemTransactions("item-1", client, db);

      const queries = idsIn(calls, "transactions", "plaid_transaction_id");
      expect(queries.length).toBeGreaterThan(1);
      for (const q of queries) expect(q.values.length).toBeLessThanOrEqual(MAX_IDS_PER_QUERY);
      // No id dropped and none queried twice -- chunking must partition the
      // batch, not sample it.
      expect(queries.flatMap((q) => q.values)).toEqual(added.map((t) => t.transaction_id));
    });

    it("splits the removed-transaction delete into bounded chunks", async () => {
      const removed = manyTxs(246, "gone").map((t) => ({ transaction_id: t.transaction_id }));
      const { db, calls } = fakeDb({ tracked: { data: [{ account_id: "acct-1", resync_after_date: null }], error: null } });
      const { client } = fakeClient([page({ removed })]);

      await syncItemTransactions("item-1", client, db);

      expect(calls.deletes.length).toBeGreaterThan(1);
      for (const [, values] of calls.deletes) {
        expect((values as unknown[]).length).toBeLessThanOrEqual(MAX_IDS_PER_QUERY);
      }
      expect(calls.deletes.flatMap(([, values]) => values as unknown[]))
        .toEqual(removed.map((t) => t.transaction_id));
    });

    it("splits a very large upsert while preserving every row", async () => {
      const added = manyTxs(1200);
      const { db, calls, client } = happyPath({}, added);

      await syncItemTransactions("item-1", client, db);

      expect(calls.upserts.length).toBe(3);
      const rows = calls.upserts.flatMap(([r]) => r as Record<string, unknown>[]);
      expect(rows).toHaveLength(1200);
      expect(rows.map((r) => r.plaid_transaction_id)).toEqual(added.map((t) => t.transaction_id));
    });

    it("advances the cursor after ingesting an oversized batch", async () => {
      // The point of the fix: a backlog this size must actually complete,
      // because a sync that throws leaves the cursor stuck and every
      // subsequent webhook replays the same doomed batch.
      const { db, calls, client } = happyPath({}, manyTxs(246));

      await expect(syncItemTransactions("item-1", client, db)).resolves.toMatchObject({ added: 246 });
      expect(calls.cursorUpdates).toHaveLength(1);
      expect((calls.cursorUpdates[0][0] as { cursor: string }).cursor).toBe("cursor-1");
    });
  });
});
