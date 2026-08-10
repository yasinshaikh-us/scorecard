// `device`, `element`, `by`, `expect`, `waitFor` are Detox globals
// injected by detox/runners/jest/testEnvironment (see e2e/jest.config.js).
//
// Broader Stage 2 coverage beyond sign-in and Plaid Link: the rest of the
// app's screens and buttons (Rules engine, transaction editing, account
// management banners, tab navigation, Ask). Deliberately ONE spec file,
// not several -- each `describe` block's own `device.launchApp` reinstalls
// the app, and that reinstall (not the interactions themselves) is most of
// what the "Run Detox specs on Firebase Test Lab" step's wall-clock time
// costs (see mobile-detox.yml's `--timeout 15m`). One shared sign-in +
// one shared "Link test bank" call, reused across every `it()` below via a
// single `beforeAll`, keeps this file's cost close to one more sign-in +
// one more link on top of testLogin.test.js / testPlaidLink.test.js,
// instead of paying that per screen.
//
// State hygiene: nothing in this file leaves the shared synthetic test
// account (synthetic-monitor@scorecard.test) in a state a LATER run of
// testLogin.test.js/testPlaidLink.test.js wouldn't expect. Concretely:
// this never completes a REAL bank disconnect (only the two-step
// disconnect banner's Cancel path is exercised -- see "Account
// management" below), and the account is left signed-in-and-linked until
// the very last test, which signs out (session-only, doesn't touch the
// linked bank). The real plaid-disconnect call itself is already covered
// with a mocked backend by components/AccountBalances.test.tsx (Stage 1).
//
// Assumes the shared test account has no OTHER category_rules of its own
// at the start of a run (a reasonable assumption for a dedicated synthetic
// account never used for anything else) -- this is what lets the Rules
// test below target the one rule it creates via `.atIndex(0)` /
// "No rules yet." rather than needing to disambiguate it from unrelated
// rows.
describe("App flows (Rules, transactions, accounts, navigation, Ask)", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });

    await element(by.id("test-signin-button")).tap();

    // Normally lands straight on Home (the shared test account already has
    // a linked bank from a prior run's "Link test bank" call) -- but stays
    // robust to a genuinely fresh account too, where app/(app)/_layout.tsx
    // shows PlaidLinkGate first instead.
    try {
      await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(8000);
    } catch {
      await element(by.id("plaid-gate-skip-button")).tap();
      await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(10000);
    }

    // Guarantees a linked account (for the account-management banners
    // below) and at least one transaction (Home's Recent Activity is
    // anchored to the ledger's OWN latest date, so whatever this seeds is
    // always "recent" -- see app/(app)/home.tsx's daysBefore comment) --
    // regardless of whatever state a previous CI run left behind.
    await element(by.id("test-plaid-link-button")).tap();
    await waitFor(element(by.id("linked-account-chip"))).toBeVisible().withTimeout(30000);
  });

  it("Rules engine: add, toggle, and delete a rule", async () => {
    await element(by.id("rules-button")).tap();
    await expect(element(by.text("Rules Engine"))).toBeVisible();

    await element(by.id("rule-match-field-button")).tap();
    await element(by.text("Category")).tap();

    await element(by.id("rule-match-value-input")).typeText("e2e-test-rule");
    await element(by.id("rule-category-select-button")).tap();
    await element(by.text("Dining")).tap();

    await element(by.id("add-rule-button")).tap();
    await waitFor(element(by.id("rule-switch-toggle")).atIndex(0)).toBeVisible().withTimeout(10000);

    // Toggling round-trips through a real DB update + apply_category_rules()
    // RPC -- the "Applied to N transaction(s)." status text is proof both
    // calls actually completed, not just that the tap didn't crash.
    await element(by.id("rule-switch-toggle")).atIndex(0).tap();
    await waitFor(element(by.id("rules-status"))).toBeVisible().withTimeout(10000);

    await element(by.id("rule-delete-button")).atIndex(0).tap();
    await expect(element(by.text("Delete this rule?"))).toBeVisible();
    await element(by.id("rule-delete-cancel-button")).tap();
    await expect(element(by.id("rule-switch-toggle")).atIndex(0)).toBeVisible();

    await element(by.id("rule-delete-button")).atIndex(0).tap();
    await element(by.id("rule-delete-confirm-button")).tap();
    await waitFor(element(by.text("No rules yet."))).toBeVisible().withTimeout(10000);

    await element(by.id("rules-close-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Transaction row: edit and save a category change", async () => {
    await waitFor(element(by.id("transaction-row")).atIndex(0)).toBeVisible().withTimeout(10000);
    await element(by.id("transaction-row")).atIndex(0).tap();

    await element(by.id("transaction-edit-category-button")).tap();
    await element(by.text("Miscellaneous")).tap();
    await element(by.id("transaction-edit-save-button")).tap();

    // Waiting for the (post-save, non-editing) category badge to actually
    // read "Miscellaneous" is a positive signal that both the save
    // completed AND edit mode closed -- no need to separately wait for
    // the edit UI to disappear.
    await waitFor(element(by.id("transaction-category-badge")).atIndex(0))
      .toHaveText("Miscellaneous")
      .withTimeout(10000);
  });

  it("Account management: add-bank and disconnect banners can be cancelled", async () => {
    await element(by.id("add-bank-button")).tap();
    await expect(element(by.id("add-bank-cancel-button"))).toBeVisible();
    await element(by.id("add-bank-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await expect(element(by.id("disconnect-cancel-button"))).toBeVisible();
    await element(by.id("disconnect-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await element(by.id("disconnect-continue-button")).tap();
    await expect(element(by.id("disconnect-final-cancel-button"))).toBeVisible();
    await element(by.id("disconnect-final-cancel-button")).tap();

    // Never taps disconnect-confirm-button -- see this file's header
    // comment on why the real disconnect call is left to Stage 1's mock.
    await expect(element(by.id("linked-account-chip")).atIndex(0)).toBeVisible();
  });

  it("Ask: a suggestion produces a card that can be closed", async () => {
    await element(by.id("tab-ask-button")).tap();
    await expect(element(by.id("ask-input"))).toBeVisible();

    await element(by.id("ask-suggestion")).atIndex(0).tap();
    // A real call to the `query` Edge Function (Anthropic-backed) -- no
    // fixed response to assert on, only that it resolves out of the
    // pending "thinking…" state into a card with a close button.
    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await element(by.id("query-card-close-button")).tap();

    await element(by.id("tab-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Sign out returns to the login screen", async () => {
    await element(by.id("sign-out-button")).tap();
    await waitFor(element(by.id("google-signin-button"))).toBeVisible().withTimeout(10000);
  });
});
