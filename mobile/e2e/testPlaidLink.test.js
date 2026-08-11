// `device`, `element`, `by`, `expect`, `waitFor` are Detox globals
// injected by detox/runners/jest/testEnvironment (see e2e/jest.config.js).
//
// Exercises Plaid Link end to end WITHOUT driving Plaid's own hosted Link
// UI, which this app doesn't own and can't reliably script (native
// WebView content, no stable testIDs to match against -- see
// mobile/README.md's Stage 2 section). Instead, taps "Link test bank"
// (see components/AccountBalances.tsx, only rendered when
// EXPO_PUBLIC_ENABLE_TEST_LOGIN is set), which calls the
// supabase/functions/test-plaid-link Edge Function -- it mints a real
// Plaid Sandbox public_token via Plaid's own /sandbox/public_token/create
// endpoint and runs it through the REAL production plaid-exchange +
// syncItemTransactions pipeline. This verifies the part of the flow this
// app actually owns (token exchange, DB writes, RLS-scoped reads, balance
// display) end to end, without the fragility of scripting a third-party
// webview.
const { captureScreen } = require("./screenshot");

describe("Plaid Link (Sandbox, test-seeded)", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("signs in, links a Sandbox test bank, and shows the linked account on Home", async () => {
    await element(by.id("test-signin-button")).tap();
    // 30s, not 15s -- see testLogin.test.js's comment on the identical
    // wait; a cold install + real Supabase auth round-trip is slower on a
    // resource-constrained CI emulator than 15s allowed for.
    await waitFor(element(by.id("home-screen")))
      .toBeVisible()
      .withTimeout(30000);

    // waitFor, not a bare tap: test-plaid-link-button lives inside
    // AccountBalances, which renders just an ActivityIndicator until its
    // own real balances fetch resolves -- home-screen being visible
    // doesn't mean that fetch has finished. A real run hit exactly this
    // race in appFlows.test.js's identical tap (see its beforeAll for the
    // same fix and why).
    await waitFor(element(by.id("test-plaid-link-button"))).toBeVisible().withTimeout(15000);
    await element(by.id("test-plaid-link-button")).tap();
    // test-plaid-link chains several real network calls (cleanup,
    // Plaid's sandboxPublicTokenCreate, the real plaid-exchange, then a
    // full transactionsSync loop) -- a longer window than the sign-in
    // wait above.
    //
    // .atIndex(0), not a bare id match: Plaid Sandbox's "First Platypus
    // Bank" test institution returns its whole account portfolio (not
    // just one account), so several linked-account-chip views are on
    // screen at once by design -- see appFlows.test.js's beforeAll for
    // the same fix and why.
    await waitFor(element(by.id("linked-account-chip")).atIndex(0))
      .toBeVisible()
      .withTimeout(30000);
    await captureScreen("plaid-link-account-chip");
  });
});
