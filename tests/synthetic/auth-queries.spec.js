import { test, expect } from "@playwright/test";
import {
  signIn,
  injectSession,
  insertTransactions,
  deleteAllTransactions,
} from "./fixtures/monitor-session.js";

// Layer 2: authenticated black-box checks against the real deployed app,
// using a dedicated monitoring Supabase user (see fixtures/monitor-session.js)
// and fixture data seeded/torn down around each test — dates are computed
// relative to the actual run time rather than hardcoded, since the app
// treats "today" as the max date in the signed-in user's own data (see
// App.jsx's buildSystemPrompt).
//
// Both tests share one monitoring account's data, so they run serially —
// running them in parallel would let one test's cleanup delete fixture
// rows the other test just inserted.
test.describe.configure({ mode: "serial" });

const FIXTURE_PAYEE = "SYNTHETIC-MONITOR-FIXTURE";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

test.describe("natural-language ledger queries", () => {
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

  test("a specific-payee question returns exactly that fixture transaction", async ({ page }) => {
    await insertTransactions(session, [
      { date: isoDate(new Date()), payee: FIXTURE_PAYEE, category: "Groceries", amount: -12.34 },
    ]);

    await injectSession(page, session);
    await page.goto("/");

    await page.getByRole("textbox").fill(`How much did I spend at ${FIXTURE_PAYEE}?`);
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText(FIXTURE_PAYEE)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("-$12.34")).toBeVisible({ timeout: 30_000 });
  });

  test("week-bucketed chart grouping doesn't shift with the viewer's timezone", async ({ browser }) => {
    // Regression test for src/logic.js's groupKeyOf("week"): it parses the
    // row date as local midnight but returns the bucket key via
    // toISOString(), which normalizes to UTC — shifting the computed
    // week-start back a day for viewers in positive-UTC-offset timezones.
    // Correct grouping is a property of the data, not the viewer's clock,
    // so the same fixture data should produce identical chart labels
    // regardless of which timezone renders them; a mismatch here
    // reproduces the bug live rather than just asserting it in the abstract.
    //
    // Fixture spans ~5 weeks and the question states the range explicitly —
    // the system prompt's own granularity rule maps that span to groupBy
    // "week" regardless of the LLM's phrasing interpretation, so this
    // reliably exercises the buggy path instead of occasionally falling
    // back to groupBy "day" (the safe, string-slicing path) for a
    // single-row, unscoped question.
    const today = new Date();
    const fiveWeeksAgo = new Date(today);
    fiveWeeksAgo.setDate(today.getDate() - 35);
    await insertTransactions(session, [
      { date: isoDate(fiveWeeksAgo), payee: FIXTURE_PAYEE, category: "Groceries", amount: -10 },
      { date: isoDate(today), payee: FIXTURE_PAYEE, category: "Groceries", amount: -20 },
    ]);

    const question = `Show me a week-by-week breakdown of my spending at ${FIXTURE_PAYEE} from ${isoDate(
      fiveWeeksAgo
    )} to ${isoDate(today)}`;

    async function chartLabelsIn(timezoneId) {
      const context = await browser.newContext({ timezoneId });
      const p = await context.newPage();
      await injectSession(p, session);
      await p.goto("/");
      await p.getByRole("textbox").fill(question);
      await p.getByRole("button", { name: "Ask" }).click();
      // recharts v3 split the tick mark and its text label into separate
      // sibling groups (.recharts-cartesian-axis-tick now wraps only the
      // line; the visible label text lives in
      // .recharts-cartesian-axis-tick-label) -- confirmed by inspecting the
      // actual rendered SVG, not inferred from a changelog. The chart
      // itself renders correctly; only this selector, written against
      // recharts v2's DOM structure, was stale.
      await expect(p.locator(".recharts-cartesian-axis-tick-label").first()).toBeVisible({ timeout: 30_000 });
      const labels = await p.locator(".recharts-cartesian-axis-tick-label").allTextContents();
      await context.close();
      return labels;
    }

    const [negativeOffsetLabels, positiveOffsetLabels] = await Promise.all([
      chartLabelsIn("America/Los_Angeles"), // UTC-7/-8: the bug does not shift dates in this direction
      chartLabelsIn("Asia/Kolkata"), // UTC+5:30: the bug shifts the week-start back a day
    ]);

    expect(
      positiveOffsetLabels,
      `Week-bucket labels differed by viewer timezone: America/Los_Angeles=${JSON.stringify(
        negativeOffsetLabels
      )} vs Asia/Kolkata=${JSON.stringify(
        positiveOffsetLabels
      )} — see the toISOString() round-trip in src/logic.js's groupKeyOf("week")`
    ).toEqual(negativeOffsetLabels);
  });
});
