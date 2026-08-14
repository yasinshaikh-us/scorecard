// `device`, `element`, `by`, `expect`, `waitFor` are Detox globals
// injected by detox/runners/jest/testEnvironment (see e2e/jest.config.js).
//
// Exercises Plaid Link end to end WITHOUT driving Plaid's own hosted Link
// UI, which this app doesn't own and can't reliably script (native
// WebView content, no stable testIDs to match against -- see
// mobile/README.md's Stage 2 section). Instead, seeds a real Plaid Sandbox
// bank by calling the supabase/functions/test-plaid-link Edge Function
// from THIS host process before the app launches (see
// e2e/testAccount.js) -- it mints a real Sandbox public_token via Plaid's
// own /sandbox/public_token/create endpoint and runs it through the REAL
// plaid-exchange + syncItemTransactions pipeline. The spec then asserts
// the part of the flow this app actually owns: that it reads that linked
// account back under RLS and renders it.
//
// The seeding used to happen through a "Link test bank" button in the app
// itself, which the spec tapped. That button is gone -- see
// e2e/testAccount.js's seedSandboxBank for what it cost and why nothing
// this spec verifies depended on it. Seeding before launch also removes
// the PlaidLinkGate detour this spec used to take: the account has a bank
// by the time the app starts, so a signed-in session lands on Home.
const { captureScreen } = require("./screenshot");
const { settleOnHome } = require("./session");
const { seedSandboxBank } = require("./testAccount");

describe("Plaid Link (Sandbox, test-seeded)", () => {
  beforeAll(async () => {
    // Before the device boots: seeding chains several real network calls
    // (cleanup, Plaid's sandboxPublicTokenCreate, the real exchange, then
    // a full transactionsSync loop), and none of it needs an emulator.
    // Doing it here rather than through the UI also takes that whole
    // chain off the device-interaction timeout budget.
    await seedSandboxBank();
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("signs in and shows the Sandbox-linked account on Home", async () => {
    await element(by.id("test-signin-button")).tap();
    // 30s, not 15s -- see testLogin.test.js's comment on the identical
    // wait; a cold install + real Supabase auth round-trip is slower on a
    // resource-constrained CI emulator than 15s allowed for.
    //
    // settleOnHome, not a bare wait on home-screen: kept even though the
    // seed above means a bank IS linked, because the gate is also what
    // this lands on if the seed silently produced nothing -- and falling
    // through to the home-screen assertion reports that far better than a
    // bare timeout would.
    await settleOnHome(30000);

    // .atIndex(0), not a bare id match: Plaid Sandbox's "First Platypus
    // Bank" test institution returns its whole account portfolio (not
    // just one account), so several linked-account-row views are on
    // screen at once by design -- see appFlows.test.js's beforeAll for
    // the same fix and why.
    //
    // Still a generous window: AccountBalances renders an
    // ActivityIndicator until its own balances fetch resolves, and that
    // fetch is slow on a resource-constrained CI emulator against an
    // account whose dataset has grown across runs.
    await waitFor(element(by.id("linked-account-row")).atIndex(0))
      .toBeVisible()
      .withTimeout(30000);
    await captureScreen("plaid-link-account-chip");
  });
});
