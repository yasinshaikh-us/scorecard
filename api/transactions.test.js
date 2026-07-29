import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler, { fetchAllRows } from "./transactions.js";

const SUPABASE_URL = "https://project.supabase.co";
const KEY = "test-key";

// Mimics Supabase/PostgREST's Range-header pagination: returns rows
// [from, to] (inclusive, 0-indexed) out of a total, page size implied by
// whatever Range the caller sends — matches the real API's contract for
// api/transactions.js's own PAGE_SIZE (1000) to exercise it.
function fakeSupabaseFetch(total, { failStatus } = {}) {
  return vi.fn(async (_url, opts) => {
    if (failStatus) {
      return { ok: false, status: failStatus, json: async () => ({ message: "boom" }) };
    }
    const [fromStr, toStr] = opts.headers.Range.split("-");
    const from = Number(fromStr);
    const to = Number(toStr);
    const rows = [];
    for (let i = from; i <= to && i < total; i++) {
      rows.push({ date: "2024-01-01", payee: `Payee${i}`, category: "Groceries", amount: "-1.50" });
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
    const rows = await fetchAllRows(SUPABASE_URL, KEY);
    expect(rows.length).toBe(2500);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][1].headers.Range).toBe("0-999");
    expect(global.fetch.mock.calls[1][1].headers.Range).toBe("1000-1999");
    expect(global.fetch.mock.calls[2][1].headers.Range).toBe("2000-2999");
  });

  it("makes one extra (empty) request when the total is an exact multiple of the page size", async () => {
    global.fetch = fakeSupabaseFetch(2000);
    const rows = await fetchAllRows(SUPABASE_URL, KEY);
    expect(rows.length).toBe(2000);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns everything in one request when under a single page", async () => {
    global.fetch = fakeSupabaseFetch(3);
    const rows = await fetchAllRows(SUPABASE_URL, KEY);
    expect(rows.length).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the key only on the apikey header (not Authorization)", async () => {
    global.fetch = fakeSupabaseFetch(1);
    await fetchAllRows(SUPABASE_URL, KEY);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.apikey).toBe(KEY);
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = fakeSupabaseFetch(0, { failStatus: 503 });
    await expect(fetchAllRows(SUPABASE_URL, KEY)).rejects.toMatchObject({
      status: 503,
      body: { message: "boom" },
    });
  });
});

describe("handler", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("rejects non-GET methods", async () => {
    const res = fakeRes();
    await handler({ method: "POST" }, res);
    expect(res.statusCode).toBe(405);
  });

  it("500s when env vars are missing", async () => {
    delete process.env.SUPABASE_URL;
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(500);
  });

  it("maps date/payee/category/amount to Date/Payee/Category/Amount with Amount coerced to a number", async () => {
    global.fetch = fakeSupabaseFetch(2);
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { Date: "2024-01-01", Payee: "Payee0", Category: "Groceries", Amount: -1.5 },
      { Date: "2024-01-01", Payee: "Payee1", Category: "Groceries", Amount: -1.5 },
    ]);
  });

  it("passes through the upstream status and error body on failure", async () => {
    global.fetch = fakeSupabaseFetch(0, { failStatus: 503 });
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: { message: "boom" } });
  });
});
