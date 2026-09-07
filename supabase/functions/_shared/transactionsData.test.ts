import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllRows, fetchAccountLabels, fetchLedgerMeta, accountLabelFor, toClientRows } from "./transactionsData.ts";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "test-anon-key";
const ACCESS_TOKEN = "test-user-access-token";

// Mimics Supabase/PostgREST's Range-header pagination: returns rows
// [from, to] (inclusive, 0-indexed) out of a total, page size implied by
// whatever Range the caller sends -- matches fetchAllRows' own PAGE_SIZE
// (1000) to exercise it.
function fakeSupabaseFetch(total: number, { failStatus, accounts = [] as any[] } = {} as any) {
  return vi.fn(async (url: any, opts: any) => {
    if (failStatus) {
      return { ok: false, status: failStatus, json: async () => ({ message: "boom" }) };
    }
    if (String(url).includes("/plaid_accounts")) {
      return { ok: true, json: async () => accounts };
    }
    const [fromStr, toStr] = opts.headers.Range.split("-");
    const from = Number(fromStr);
    const to = Number(toStr);
    const rows = [];
    for (let i = from; i <= to && i < total; i++) {
      rows.push({ id: i, date: "2024-01-01", payee: `Payee${i}`, category: "Groceries", amount: "-1.50" });
    }
    return { ok: true, json: async () => rows };
  });
}

describe("fetchAllRows", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("pages through multiple partial pages and returns every row (regression test for the Max Rows truncation bug)", async () => {
    global.fetch = fakeSupabaseFetch(2500) as any;
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(2500);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect((global.fetch as any).mock.calls[0][1].headers.Range).toBe("0-999");
    expect((global.fetch as any).mock.calls[1][1].headers.Range).toBe("1000-1999");
    expect((global.fetch as any).mock.calls[2][1].headers.Range).toBe("2000-2999");
  });

  it("makes one extra (empty) request when the total is an exact multiple of the page size", async () => {
    global.fetch = fakeSupabaseFetch(2000) as any;
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(2000);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns everything in one request when under a single page", async () => {
    global.fetch = fakeSupabaseFetch(3) as any;
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // PostgREST returns exactly the columns named in `select`, so a column
  // missing here is not an error anywhere -- it just arrives undefined
  // and every row silently reads as settled. Naming the whole list is
  // what makes dropping one a test failure rather than a quiet
  // regression in the app.
  it("selects every column the client shape is built from", async () => {
    global.fetch = fakeSupabaseFetch(1) as any;
    await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    const url = String((global.fetch as any).mock.calls[0][0]);
    const selected = decodeURIComponent(url.split("select=")[1].split("&")[0]).split(",");
    expect(selected).toEqual([
      "id",
      "date",
      "payee",
      "category",
      "amount",
      "plaid_account_id",
      "is_transfer",
      "pending",
    ]);
  });

  it("sends the anon key on apikey and the caller's own access token on Authorization", async () => {
    global.fetch = fakeSupabaseFetch(1) as any;
    await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    const headers = (global.fetch as any).mock.calls[0][1].headers;
    expect(headers.apikey).toBe(ANON_KEY);
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = fakeSupabaseFetch(0, { failStatus: 503 }) as any;
    await expect(fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });
});

describe("fetchAccountLabels", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("builds a name+mask label keyed by account_id", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { account_id: "acc_1", name: "Chase Checking", mask: "1234" },
        { account_id: "acc_2", name: "Ally Savings", mask: null },
      ],
    })) as any;
    const labels = await fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(labels).toEqual({ acc_1: "Chase Checking ••1234", acc_2: "Ally Savings" });
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: "boom" }) })) as any;
    await expect(fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });

  it("truncates a longer-than-4-digit mask down to the last 4 digits", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ account_id: "acc_1", name: "Chase Checking", mask: "123456789" }],
    })) as any;
    const labels = await fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(labels).toEqual({ acc_1: "Chase Checking ••6789" });
  });
});

describe("fetchLedgerMeta", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("posts to the ledger_meta RPC with the caller's own token and maps the response", async () => {
    global.fetch = vi.fn(async (url: any, opts: any) => {
      expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/ledger_meta`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.apikey).toBe(ANON_KEY);
      expect(opts.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      return {
        ok: true,
        json: async () => [
          {
            categories: ["Groceries", "Home"],
            subcategories: ["Groceries:Food", "Home:Rent"],
            min_date: "2024-01-01",
            max_date: "2024-06-01",
            distinct_account_ids: ["acc_1"],
            has_manual: true,
          },
        ],
      };
    }) as any;
    const meta = await fetchLedgerMeta(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(meta).toEqual({
      categories: ["Groceries", "Home"],
      subcategories: ["Groceries:Food", "Home:Rent"],
      minDate: "2024-01-01",
      maxDate: "2024-06-01",
      accountIds: ["acc_1"],
      hasManual: true,
    });
  });

  it("defaults every field for an empty ledger (no rows for this user)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { categories: [], subcategories: [], min_date: null, max_date: null, distinct_account_ids: [], has_manual: false },
      ],
    })) as any;
    const meta = await fetchLedgerMeta(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(meta).toEqual({
      categories: [],
      subcategories: [],
      minDate: "",
      maxDate: "",
      accountIds: [],
      hasManual: false,
    });
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: "boom" }) })) as any;
    await expect(fetchLedgerMeta(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });
});

describe("accountLabelFor", () => {
  it("returns 'Manual entry' for a row with no plaid_account_id", () => {
    expect(accountLabelFor({ plaid_account_id: null }, {})).toBe("Manual entry");
  });
  it("returns the resolved label for a linked row", () => {
    expect(accountLabelFor({ plaid_account_id: "acc_1" }, { acc_1: "Chase Checking ••1234" })).toBe("Chase Checking ••1234");
  });
  it("falls back to a generic label when the account id isn't in the labels map", () => {
    expect(accountLabelFor({ plaid_account_id: "acc_unknown" }, {})).toBe("Linked account");
  });
});

describe("toClientRows", () => {
  it("maps raw rows to the client shape, resolving Account and coercing IsTransfer/Pending", () => {
    const out = toClientRows(
      [
        { id: 1, date: "2024-01-01", payee: "Store", category: "Groceries", amount: "-1.5", plaid_account_id: "acc_1", is_transfer: false, pending: false },
        { id: 2, date: "2024-01-02", payee: "Transfer", category: "Transfer", amount: "-500", plaid_account_id: "acc_1", is_transfer: true, pending: false },
        { id: 3, date: "2024-01-03", payee: "Cafe", category: "Dining", amount: "-4.25", plaid_account_id: "acc_1", is_transfer: false, pending: true },
      ],
      { acc_1: "Chase Checking ••1234" }
    );
    expect(out).toEqual([
      { Id: 1, Date: "2024-01-01", Payee: "Store", Category: "Groceries", Amount: -1.5, Account: "Chase Checking ••1234", IsTransfer: false, Pending: false },
      { Id: 2, Date: "2024-01-02", Payee: "Transfer", Category: "Transfer", Amount: -500, Account: "Chase Checking ••1234", IsTransfer: true, Pending: false },
      { Id: 3, Date: "2024-01-03", Payee: "Cafe", Category: "Dining", Amount: -4.25, Account: "Chase Checking ••1234", IsTransfer: false, Pending: true },
    ]);
  });

  // A row written before the pending column existed comes back from
  // PostgREST with the column present and false, but a manual row built
  // in a test (or any caller passing a partial row) has no such key --
  // and "no flag" must mean settled, never undefined leaking into the
  // client shape.
  it("treats a row with no pending column as settled", () => {
    const out = toClientRows(
      [{ id: 1, date: "2024-01-01", payee: "Cash", category: "Groceries", amount: "-3", is_transfer: false }],
      {}
    );
    expect(out[0].Pending).toBe(false);
  });

  // Pending rows are a display distinction, not a filter: a charge you
  // have made is spending whether or not it has settled, and dropping it
  // here would put every total in the app behind the bank's own
  // available balance.
  it("serves pending rows alongside settled ones rather than filtering them out", () => {
    const out = toClientRows(
      [
        { id: 1, date: "2024-01-01", payee: "Settled", category: "Groceries", amount: "-10", pending: false },
        { id: 2, date: "2024-01-02", payee: "Authorized", category: "Groceries", amount: "-20", pending: true },
      ],
      {}
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.Payee)).toEqual(["Settled", "Authorized"]);
  });
});
