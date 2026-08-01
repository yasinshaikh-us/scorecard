import { test, expect } from "@playwright/test";
import {
  signIn,
  injectSession,
  insertTransactions,
  deleteAllTransactions,
} from "./fixtures/monitor-session.js";

// Layer 2 expansion: a broader matrix of real natural-language queries
// against the deployed app, covering the filter/grouping dimensions
// auth-queries.spec.js's two targeted tests don't touch — categories,
// subcategories, income/expense, amount ranges, day/month/year-spanning
// date ranges, category breakdowns, off-topic rejection, and empty
// results. Each test seeds its own uniquely-named fixture rows so
// assertions can check exactly which payees do/don't appear, rather than
// relying on totals.
//
// All tests share one monitoring account's data, so they run serially —
// running them in parallel would let one test's cleanup delete fixture
// rows another test just inserted.
test.describe.configure({ mode: "serial" });

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

test.describe("expanded ledger scenario matrix", () => {
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

  test("a top-level category question isolates only that category", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-GROCERY", category: "Groceries", amount: -30 },
      { date: today, payee: "SYNTHETIC-MATRIX-DINING", category: "Dining & Drinks:Restaurants", amount: -25 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("How much did I spend on Groceries?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-GROCERY")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-DINING")).toHaveCount(0);
  });

  test("a subcategory question (categoryContains) isolates rent from mortgage", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-RENT", category: "Home:Rent", amount: -1200 },
      { date: today, payee: "SYNTHETIC-MATRIX-MORTGAGE", category: "Home:Mortgage", amount: -2000 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("How much did I spend on rent?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-RENT")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-MORTGAGE")).toHaveCount(0);
  });

  test("an income question excludes expenses", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-PAYCHECK", category: "Personal Income:Paycheck", amount: 3000 },
      { date: today, payee: "SYNTHETIC-MATRIX-EXPENSE", category: "Shopping", amount: -40 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("How much income did I receive?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-PAYCHECK")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-EXPENSE")).toHaveCount(0);
  });

  test("an amount-range question filters by magnitude", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-SMALL", category: "Shopping", amount: -10 },
      { date: today, payee: "SYNTHETIC-MATRIX-MID", category: "Shopping", amount: -50 },
      { date: today, payee: "SYNTHETIC-MATRIX-BIG", category: "Shopping", amount: -500 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("Show me purchases between $20 and $100");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-MID")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-SMALL")).toHaveCount(0);
    await expect(page.getByText("SYNTHETIC-MATRIX-BIG")).toHaveCount(0);
  });

  test("a narrow single-day question renders a chart grouped by day", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-TODAY", category: "Shopping", amount: -15 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("What did I spend today?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-TODAY")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
  });

  test("a ~5-month-spanning question groups by month and includes both endpoints", async ({ page }) => {
    const end = new Date();
    const start = monthsAgo(5);
    await insertTransactions(session, [
      { date: isoDate(start), payee: "SYNTHETIC-MATRIX-OLDEST", category: "Shopping", amount: -20 },
      { date: isoDate(end), payee: "SYNTHETIC-MATRIX-NEWEST", category: "Shopping", amount: -30 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page
      .getByRole("textbox")
      .fill(`Show me a month-by-month breakdown of all my spending from ${isoDate(start)} to ${isoDate(end)}`);
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-OLDEST")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-NEWEST")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
  });

  test("a 14-month-spanning question crossing a year boundary includes both endpoints", async ({ page }) => {
    const end = new Date();
    const start = monthsAgo(14);
    await insertTransactions(session, [
      { date: isoDate(start), payee: "SYNTHETIC-MATRIX-LASTYEAR", category: "Shopping", amount: -20 },
      { date: isoDate(end), payee: "SYNTHETIC-MATRIX-THISYEAR", category: "Shopping", amount: -30 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page
      .getByRole("textbox")
      .fill(`Show me a month-by-month breakdown of all my spending from ${isoDate(start)} to ${isoDate(end)}`);
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-LASTYEAR")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-THISYEAR")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
  });

  test("a category-breakdown question shows every seeded category", async ({ page }) => {
    const today = isoDate(new Date());
    await insertTransactions(session, [
      { date: today, payee: "SYNTHETIC-MATRIX-CATA", category: "Groceries", amount: -40 },
      { date: today, payee: "SYNTHETIC-MATRIX-CATB", category: "Entertainment", amount: -60 },
    ]);

    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("Show me a breakdown of my spending by category");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("SYNTHETIC-MATRIX-CATA")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SYNTHETIC-MATRIX-CATB")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
  });

  test("an off-topic question is rejected against the live app", async ({ page }) => {
    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("What is the weather currently in New York?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(
      page.getByText(/only answers questions about your own bank-transaction ledger/)
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
  });

  test("a query matching nothing renders the empty-table state", async ({ page }) => {
    await injectSession(page, session);
    await page.goto("/");
    await page.getByRole("textbox").fill("How much did I spend at SYNTHETIC-MATRIX-DOES-NOT-EXIST-ANYWHERE?");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByText("No matching transactions")).toBeVisible({ timeout: 30_000 });
  });
});
