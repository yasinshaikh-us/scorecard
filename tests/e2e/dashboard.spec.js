import { test, expect } from "@playwright/test";

// Auth is Google OAuth via Supabase (see middleware.js, src/Login.jsx);
// a real "Continue with Google" flow can't be driven headlessly here, so
// instead of signing in for real, each authenticated test seeds a
// locally-fabricated (unsigned, never sent anywhere) session directly
// into localStorage under supabase-js's own storage key — that's enough
// for auth.getSession() to resolve locally without a network call, which
// is all App.jsx's auth gate checks before rendering the dashboard.
// Actual data access is still fully mocked at the network layer below, so
// this needs no real Supabase/Anthropic credentials either way.
const FAKE_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJleHAiOjQwNzA5MDg4MDAsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.fakesignature";

async function signInFake(page) {
  await page.addInitScript((jwt) => {
    const session = {
      access_token: jwt,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 4070908800,
      refresh_token: "fake-refresh-token",
      user: { id: "11111111-1111-1111-1111-111111111111", email: "test@example.com" },
    };
    // Storage key format is supabase-js's own convention:
    // `sb-<project-ref>-auth-token`, ref parsed from VITE_SUPABASE_URL
    // (playwright.config.js sets it to https://e2e-test-project.supabase.co).
    localStorage.setItem("sb-e2e-test-project-auth-token", JSON.stringify(session));
  }, FAKE_ACCESS_TOKEN);
}

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

test("an unauthenticated visitor sees the Google sign-in screen, not the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
});

// Both authenticated tests below are exercising ledger Q&A, not the
// bank-linking flow, so they mock plaid_items as "already linked" —
// otherwise App.jsx would show the (unrelated) PlaidLinkGate screen
// instead of the dashboard these tests assert against.
function mockAlreadyLinked(page) {
  return page.route("**/rest/v1/plaid_items*", (route) =>
    route.fulfill({ json: [{ id: "item-1", institution_name: "Test Bank", status: "active" }] })
  );
}

test("asking a question renders only the matching transactions and a chart", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
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
  await signInFake(page);
  await mockAlreadyLinked(page);
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
