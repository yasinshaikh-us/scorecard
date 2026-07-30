import { test, expect } from "@playwright/test";

// Fixture data standing in for what /api/transactions (Supabase) would
// return, and a canned filter spec standing in for what /api/query
// (Anthropic) would return for a "how much did I spend on groceries?"
// question — both mocked at the network layer so this test needs no real
// credentials.
const FIXTURE_ROWS = [
  { Date: "2026-01-05", Payee: "Chase Mortgage", Category: "Home:Mortgage", Amount: -5712.04 },
  { Date: "2026-01-10", Payee: "Chipotle", Category: "Dining & Drinks:Restaurants", Amount: -21.95 },
  { Date: "2026-01-15", Payee: "QFC Foods", Category: "Groceries", Amount: -45.5 },
];

const FIXTURE_SPEC = {
  isLedgerQuery: true,
  categories: ["Groceries"],
  categoryContains: null,
  payeeContains: null,
  dateStart: null,
  dateEnd: null,
  type: "expense",
  amountMin: null,
  amountMax: null,
  chartType: "bar",
  groupBy: "category",
  title: "Grocery spending",
};

test("asking a question renders only the matching transactions and a chart", async ({ page }) => {
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));
  await page.route("**/api/query", (route) =>
    route.fulfill({
      json: { content: [{ type: "text", text: JSON.stringify(FIXTURE_SPEC) }] },
    })
  );

  await page.goto("/");

  const askButton = page.getByRole("button", { name: "Ask" });
  await expect(askButton).toBeEnabled();

  await page.getByRole("textbox").fill("How much did I spend on groceries?");
  await askButton.click();

  await expect(page.getByText("Grocery spending")).toBeVisible();

  // Only the Groceries-category row should show up.
  await expect(page.getByText("QFC Foods")).toBeVisible();
  await expect(page.getByText("Chase Mortgage")).toHaveCount(0);
  await expect(page.getByText("Chipotle")).toHaveCount(0);

  // A chart rendered alongside the table.
  await expect(page.locator(".recharts-wrapper")).toBeVisible();
});

test("an off-topic question is rejected instead of silently showing all transactions", async ({ page }) => {
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));
  await page.route("**/api/query", (route) =>
    route.fulfill({
      json: { content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: false }) }] },
    })
  );

  await page.goto("/");

  await page.getByRole("textbox").fill("What is the weather currently in New York?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByText(/only answers questions about your own bank-transaction ledger/)).toBeVisible();

  // No chart or transaction rows should have been rendered for a rejected question.
  await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
  await expect(page.getByText("Chase Mortgage")).toHaveCount(0);
});
