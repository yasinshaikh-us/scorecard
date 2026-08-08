import { test, expect } from "@playwright/test";
import { signIn, insertTransactions, deleteAllTransactions } from "./fixtures/monitor-session.js";

// Layer 3: compares a known value written directly to Supabase against
// what the app's own API returns for that same row — the strongest
// signal for a date/serialization bug, since it checks against ground
// truth rather than another derived value.

test.describe("direct Supabase cross-check", () => {
  let session;

  test.beforeAll(async () => {
    session = await signIn();
  });

  test.beforeEach(async () => {
    await deleteAllTransactions(session);
  });

  test.afterAll(async () => {
    if (session) await deleteAllTransactions(session);
  });

  test("the transactions Edge Function returns the exact date stored in Supabase", async ({ request }) => {
    const knownDate = "2026-02-14"; // fixed, arbitrary — exercises exact date-string passthrough
    await insertTransactions(session, [
      { date: knownDate, payee: "SYNTHETIC-MONITOR-CROSSCHECK", category: "Groceries", amount: -1 },
    ]);

    const resp = await request.get(`${process.env.MONITOR_SUPABASE_URL}/functions/v1/transactions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(resp.status()).toBe(200);
    const rows = await resp.json();
    const row = rows.find((r) => r.Payee === "SYNTHETIC-MONITOR-CROSSCHECK");
    expect(row, "fixture row should be present in the transactions Edge Function response").toBeTruthy();
    expect(row.Date).toBe(knownDate);
  });
});
