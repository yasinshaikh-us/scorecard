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

function mockAccountBalances(page, accounts, balances) {
  return Promise.all([
    page.route("**/rest/v1/plaid_accounts*", (route) => route.fulfill({ json: accounts })),
    page.route("**/rest/v1/plaid_account_balances*", (route) => route.fulfill({ json: balances })),
  ]);
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

  await page.goto("/ask");

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

const WEEKLY_ROWS = [
  { Date: "2026-01-05", Payee: "Week1 Purchase", Category: "Groceries", Amount: -100 },
  { Date: "2026-01-12", Payee: "Week2 Purchase", Category: "Groceries", Amount: -200 },
  { Date: "2026-01-19", Payee: "Week3 Purchase", Category: "Groceries", Amount: -300 },
];

const WEEKLY_SPEC = {
  isLedgerQuery: true,
  categories: null,
  categoryContains: null,
  payeeContains: null,
  dateStart: "2026-01-01",
  dateEnd: "2026-01-31",
  type: "all",
  amountMin: null,
  amountMax: null,
  chartType: "bar",
  groupBy: "week",
  title: "Weekly spend",
};

test("clicking through multiple chart bars filters the table to each bar in turn, with no leftover focus outline (regression: Recharts' entrance animation used to leave bars in a transient state where an early click could hit the wrong bar or none at all)", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: WEEKLY_ROWS }));
  await page.route("**/api/query", (route) =>
    route.fulfill({ json: { content: [{ type: "text", text: JSON.stringify(WEEKLY_SPEC) }] } })
  );

  await page.goto("/ask");
  await page.getByRole("textbox").fill("weekly spend in january");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Weekly spend", { exact: true })).toBeVisible();

  const bars = page.locator(".recharts-bar-rectangle");
  await expect(bars).toHaveCount(3);

  // Click every bar in turn (immediately, no settling delay) and confirm
  // the table always narrows to exactly that bar's transaction, never an
  // unfiltered list and never the wrong week's row.
  await bars.nth(0).click();
  await expect(page.getByText("Week1 Purchase")).toBeVisible();
  await expect(page.getByText("Week2 Purchase")).toHaveCount(0);

  await bars.nth(1).click();
  await expect(page.getByText("Week2 Purchase")).toBeVisible();
  await expect(page.getByText("Week1 Purchase")).toHaveCount(0);

  await bars.nth(2).click();
  await expect(page.getByText("Week3 Purchase")).toBeVisible();
  await expect(page.getByText("Week2 Purchase")).toHaveCount(0);

  // Clicking a chart element focuses it (Recharts' accessibility layer);
  // that focus must not leave a visible outline around the whole chart.
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).toBe("none");
});

const MONTHLY_ROWS = [
  { Date: "2026-01-15", Payee: "Jan Purchase", Category: "Groceries", Amount: -100 },
  { Date: "2026-02-15", Payee: "Feb Purchase", Category: "Groceries", Amount: -200 },
  { Date: "2026-03-15", Payee: "Mar Purchase", Category: "Groceries", Amount: -300 },
];

const MONTHLY_SPEC = {
  isLedgerQuery: true,
  categories: null,
  categoryContains: null,
  payeeContains: null,
  dateStart: "2026-01-01",
  dateEnd: "2026-03-31",
  type: "all",
  amountMin: null,
  amountMax: null,
  chartType: "line",
  groupBy: "month",
  title: "Monthly spend",
};

test("clicking a line chart point filters the table to that point, same as clicking a bar (regression: the line chart had no click handler at all, so it never filtered)", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: MONTHLY_ROWS }));
  await page.route("**/api/query", (route) =>
    route.fulfill({ json: { content: [{ type: "text", text: JSON.stringify(MONTHLY_SPEC) }] } })
  );

  await page.goto("/ask");
  await page.getByRole("textbox").fill("monthly spend");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Monthly spend", { exact: true })).toBeVisible();

  const dots = page.locator(".recharts-line-dots circle");
  await expect(dots).toHaveCount(3);

  await dots.nth(0).click();
  await expect(page.getByText("Jan Purchase")).toBeVisible();
  await expect(page.getByText("Feb Purchase")).toHaveCount(0);

  await dots.nth(1).click();
  await expect(page.getByText("Feb Purchase")).toBeVisible();
  await expect(page.getByText("Jan Purchase")).toHaveCount(0);

  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).toBe("none");
});

test("lists a balance chip per linked account on the home screen", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await mockAccountBalances(
    page,
    [
      { account_id: "acc_checking", name: "Chase Checking", mask: "1234" },
      { account_id: "acc_savings", name: "Ally Savings", mask: "5678" },
    ],
    [
      { account_id: "acc_checking", current: 2543.21, available: 2500 },
      { account_id: "acc_savings", current: 18000.5, available: 18000.5 },
    ]
  );
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));

  await page.goto("/");

  await expect(page.getByText("Account Balances")).toBeVisible();
  await expect(page.getByText("Chase Checking ••1234")).toBeVisible();
  await expect(page.getByText("$2,543.21")).toBeVisible();
  await expect(page.getByText("Ally Savings ••5678")).toBeVisible();
  await expect(page.getByText("$18,000.50")).toBeVisible();

  // The only way to link a bank after the first-login gate is this
  // button -- it must stay available even once accounts are linked, so
  // a second/third bank can be added too.
  await expect(page.getByRole("button", { name: "+ Add bank" })).toBeVisible();
});

test("shows an empty state (not a balance chip) for a manual-only ledger, with an Add bank button to link one", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await mockAccountBalances(page, [], []);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));

  await page.goto("/");

  await expect(page.getByText("Quick Questions")).toBeVisible();
  await expect(page.getByText("Account Balances")).toHaveCount(0);
  await expect(page.getByText("Balance", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No linked accounts yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add bank" })).toBeVisible();
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

  await page.goto("/ask");

  await page.getByRole("textbox").fill("What is the weather currently in New York?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByText(/only answers questions about your own bank-transaction ledger/)).toBeVisible();

  // No chart or transaction rows should have been rendered for a rejected question.
  await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
  await expect(page.getByText("Chase Mortgage")).toHaveCount(0);
});

function mockNoLinkedAccounts(page) {
  return Promise.all([
    page.route("**/rest/v1/plaid_accounts*", (route) => route.fulfill({ json: [] })),
    page.route("**/rest/v1/plaid_account_balances*", (route) => route.fulfill({ json: [] })),
  ]);
}

test("navigating from Home to Ask and back with the browser Back button works, and the URL reflects each page", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await mockNoLinkedAccounts(page);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));

  await page.goto("/");
  await expect(page.getByText("Quick Questions")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.getByRole("link", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByText("Quick Questions")).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Quick Questions")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByRole("textbox")).toBeVisible();
});

test("clicking a Home shortcut pill jumps to Ask and runs the canned question automatically", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await mockNoLinkedAccounts(page);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));
  await page.route("**/api/query", (route) =>
    route.fulfill({ json: { content: [{ type: "text", text: JSON.stringify(FIXTURE_SPEC) }] } })
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Top categories" }).click();

  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByText("Grocery spending")).toBeVisible();
  await expect(page.getByText("QFC Foods")).toBeVisible();
});

test("Rules is reachable from Home, and closing it (X or Back) returns to the page that opened it", async ({ page }) => {
  await signInFake(page);
  await mockAlreadyLinked(page);
  await mockNoLinkedAccounts(page);
  await page.route("**/api/transactions", (route) => route.fulfill({ json: FIXTURE_ROWS }));
  await page.route("**/rest/v1/category_rules*", (route) => route.fulfill({ json: [] }));

  await page.goto("/");
  await page.getByRole("link", { name: "Rules" }).click();
  await expect(page.getByText("Rules Engine")).toBeVisible();

  await page.getByRole("button", { name: "×" }).click();
  await expect(page.getByText("Rules Engine")).toHaveCount(0);
  await expect(page.getByText("Quick Questions")).toBeVisible();
});
