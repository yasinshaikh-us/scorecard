import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler, { fetchAllRows, fetchAccountLabels, accountLabelFor, toClientRows } from "./transactions.js";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "test-anon-key";
const ACCESS_TOKEN = "test-user-access-token";

// Mimics Supabase/PostgREST's Range-header pagination: returns rows
// [from, to] (inclusive, 0-indexed) out of a total, page size implied by
// whatever Range the caller sends — matches the real API's contract for
// api/transactions.js's own PAGE_SIZE (1000) to exercise it. The handler
// now also fires an unpaged request against plaid_accounts (for account
// labels) alongside the paged transactions request, so this branches on
// the URL to serve both from a single mock.
function fakeSupabaseFetch(total, { failStatus, accounts = [] } = {}) {
  return vi.fn(async (url, opts) => {
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

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("fetchAllRows", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("pages through multiple partial pages and returns every row (regression test for the Max Rows truncation bug)", async () => {
    global.fetch = fakeSupabaseFetch(2500);
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(2500);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][1].headers.Range).toBe("0-999");
    expect(global.fetch.mock.calls[1][1].headers.Range).toBe("1000-1999");
    expect(global.fetch.mock.calls[2][1].headers.Range).toBe("2000-2999");
  });

  it("makes one extra (empty) request when the total is an exact multiple of the page size", async () => {
    global.fetch = fakeSupabaseFetch(2000);
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(2000);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns everything in one request when under a single page", async () => {
    global.fetch = fakeSupabaseFetch(3);
    const rows = await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(rows.length).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the anon key on apikey and the caller's own access token on Authorization", async () => {
    global.fetch = fakeSupabaseFetch(1);
    await fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.apikey).toBe(ANON_KEY);
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = fakeSupabaseFetch(0, { failStatus: 503 });
    await expect(fetchAllRows(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });
});

describe("handler", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("rejects non-GET methods", async () => {
    const res = fakeRes();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("500s when env vars are missing", async () => {
    delete process.env.VITE_SUPABASE_URL;
    const res = fakeRes();
    await handler({ method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }, res);
    expect(res.statusCode).toBe(500);
  });

  it("401s when there's no Authorization header (defense in depth alongside middleware.js)", async () => {
    const res = fakeRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("maps date/payee/category/amount to Date/Payee/Category/Amount with Amount coerced to a number, defaulting Account/IsTransfer for unlinked manual rows", async () => {
    global.fetch = fakeSupabaseFetch(2);
    const res = fakeRes();
    await handler({ method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { Id: 0, Date: "2024-01-01", Payee: "Payee0", Category: "Groceries", Amount: -1.5, Account: "Manual entry", IsTransfer: false },
      { Id: 1, Date: "2024-01-01", Payee: "Payee1", Category: "Groceries", Amount: -1.5, Account: "Manual entry", IsTransfer: false },
    ]);
  });

  it("passes through the upstream status and error body on failure", async () => {
    global.fetch = fakeSupabaseFetch(0, { failStatus: 503 });
    const res = fakeRes();
    await handler({ method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: { message: "boom" } });
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
    }));
    const labels = await fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(labels).toEqual({ acc_1: "Chase Checking ••1234", acc_2: "Ally Savings" });
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: "boom" }) }));
    await expect(fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });

  it("truncates a longer-than-4-digit mask down to the last 4 digits", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ account_id: "acc_1", name: "Chase Checking", mask: "123456789" }],
    }));
    const labels = await fetchAccountLabels(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(labels).toEqual({ acc_1: "Chase Checking ••6789" });
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
  it("maps raw rows to the client shape, resolving Account and coercing IsTransfer", () => {
    const out = toClientRows(
      [
        { id: 1, date: "2024-01-01", payee: "Store", category: "Groceries", amount: "-1.5", plaid_account_id: "acc_1", is_transfer: false },
        { id: 2, date: "2024-01-02", payee: "Transfer", category: "Transfer", amount: "-500", plaid_account_id: "acc_1", is_transfer: true },
      ],
      { acc_1: "Chase Checking ••1234" }
    );
    expect(out).toEqual([
      { Id: 1, Date: "2024-01-01", Payee: "Store", Category: "Groceries", Amount: -1.5, Account: "Chase Checking ••1234", IsTransfer: false },
      { Id: 2, Date: "2024-01-02", Payee: "Transfer", Category: "Transfer", Amount: -500, Account: "Chase Checking ••1234", IsTransfer: true },
    ]);
  });
});
