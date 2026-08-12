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
const { captureScreen } = require("./screenshot");

describe("App flows (Rules, transactions, accounts, navigation, Ask)", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });

    await element(by.id("test-signin-button")).tap();

    // Normally lands straight on Home (the shared test account already has
    // a linked bank from a prior run's "Link test bank" call) -- but stays
    // robust to a genuinely fresh account too, where app/(app)/_layout.tsx
    // shows PlaidLinkGate first instead.
    //
    // 30s, not 8s/10s -- see testLogin.test.js's comment on the identical
    // wait; a cold install + real Supabase auth round-trip is slower on a
    // resource-constrained CI emulator than the original budget allowed
    // for.
    try {
      await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(30000);
    } catch {
      await element(by.id("plaid-gate-skip-button")).tap();
      await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(30000);
    }

    // Guarantees a linked account (for the account-management banners
    // below) and at least one transaction (Home's Recent Activity is
    // anchored to the ledger's OWN latest date, so whatever this seeds is
    // always "recent" -- see app/(app)/home.tsx's daysBefore comment) --
    // regardless of whatever state a previous CI run left behind.
    //
    // .atIndex(0), not a bare id match: Plaid Sandbox's "First Platypus
    // Bank" test institution (see test-plaid-link/index.ts) returns its
    // whole account portfolio -- checking, savings, CD, and more --  not
    // just one account, so several linked-account-chip views are always
    // on screen at once by design (confirmed via a real run: exactly one
    // plaid_items row, freshly created, with 12 accounts under it -- this
    // is expected Sandbox data, not accumulated cruft from prior runs).
    // waitFor, not a bare tap: test-plaid-link-button lives inside
    // AccountBalances, which renders just an ActivityIndicator ("Loading…")
    // until its own real balances fetch resolves (see AccountBalances.tsx)
    // -- home-screen itself being visible doesn't mean that fetch has
    // finished. A real run hit exactly this: "No views in hierarchy found
    // matching: ... test-plaid-link-button" with the hierarchy dump
    // showing "Loading…" still on screen. This line never had a wait
    // before, and simply hadn't been unlucky enough to fail until the
    // shared test account's dataset (transactions, rules) grew large
    // enough across repeated runs to slow the fetch down.
    await waitFor(element(by.id("test-plaid-link-button"))).toBeVisible().withTimeout(15000);
    await element(by.id("test-plaid-link-button")).tap();
    await waitFor(element(by.id("linked-account-chip")).atIndex(0)).toBeVisible().withTimeout(30000);
    await captureScreen("home-with-linked-account");
  });

  it("Rules engine: add, toggle, and delete a rule", async () => {
    await element(by.id("rules-button")).tap();
    await expect(element(by.text("Rules Engine"))).toBeVisible();

    await element(by.id("rule-match-field-button")).tap();
    // Cancel first -- confirms dismissing a picker without selecting
    // leaves the prior value alone, not just that selecting one works.
    await element(by.id("picker-cancel-button")).tap();
    // toHaveText() needs the actual native TextView -- rule-match-field-
    // button is the outer Pressable (a View, confirmed by a real run's
    // failure: "Got: ... ReactViewGroup" instead of a TextView) -- match
    // the visible label text directly instead.
    await expect(element(by.text("Payee"))).toBeVisible();

    await element(by.id("rule-match-field-button")).tap();
    await element(by.text("Category")).tap();

    await element(by.id("rule-match-value-input")).typeText("e2e-test-rule");
    // tapReturnKey(), not straight into the next tap: a real run (see
    // rules-engine-with-rule's failure video/hierarchy dump from a prior
    // attempt) showed the software keyboard still up and the match-value
    // text mid-typed at the moment "set category to" was tapped, and the
    // picker never opened -- Android's real soft keyboard can eat that
    // first tap as a dismiss rather than passing it through to the
    // button underneath. A Stage 1 (RNTL) render of this exact tap
    // sequence confirmed the component's own state logic opens the
    // picker correctly, so this is a real-device-only keyboard timing
    // issue, not an app bug.
    await element(by.id("rule-match-value-input")).tapReturnKey();
    await element(by.id("rule-category-select-button")).tap();
    // "Dining" is real (see lib/categories.ts's 19-category set) but it's
    // the 8th entry in the picker's height-capped, scrollable list -- a
    // real run confirmed the picker now opens correctly (tapReturnKey()
    // fixed that), but "Dining" itself was off-screen below the fold,
    // so the bare waitFor().toBeVisible() timed out on something that
    // was never going to scroll into view on its own. whileElement's
    // scroll-until-visible is Detox's standard pattern for exactly this.
    await waitFor(element(by.text("Dining")))
      .toBeVisible()
      .whileElement(by.id("picker-options-list"))
      .scroll(150, "down");
    await element(by.text("Dining")).tap();

    // Not a bare tap: the category PickerModal's own closing animation
    // (animationType="slide") can still be occluding add-rule-button for
    // a beat after the "Dining" tap fires onSelect+onClose -- a real run
    // failed here with "No views in hierarchy found matching... add-rule-
    // button" while the picker's view hierarchy was still in the dump.
    await waitFor(element(by.id("add-rule-button"))).toBeVisible().withTimeout(5000);
    await element(by.id("add-rule-button")).tap();
    await waitFor(element(by.id("rule-switch-toggle")).atIndex(0)).toBeVisible().withTimeout(10000);
    await captureScreen("rules-engine-with-rule");

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

  it("Rules engine: a rule that sets payee (not just category)", async () => {
    // Only category-setting rules were ever exercised here before --
    // set_payee is a real, separate column (see SCHEMA.md's category_rules
    // table) with its own " → payee X" rendering branch in
    // CategoryRulesPanel.tsx, untested anywhere on a real device.
    await element(by.id("rules-button")).tap();
    await expect(element(by.text("Rules Engine"))).toBeVisible();

    // match_field defaults to "payee" -- no picker needed for this one.
    await element(by.id("rule-match-value-input")).typeText("e2e-payee-rule");
    await element(by.id("rule-match-value-input")).tapReturnKey();
    await element(by.id("rule-set-payee-input")).typeText("E2E Renamed Payee");
    await element(by.id("rule-set-payee-input")).tapReturnKey();

    await element(by.id("add-rule-button")).tap();
    await waitFor(element(by.text('if payee contains "e2e-payee-rule" → payee E2E Renamed Payee')))
      .toBeVisible()
      .withTimeout(10000);
    await captureScreen("rules-engine-payee-rule");

    await element(by.id("rule-delete-button")).atIndex(0).tap();
    await element(by.id("rule-delete-confirm-button")).tap();
    await waitFor(element(by.text("No rules yet."))).toBeVisible().withTimeout(10000);

    await element(by.id("rules-close-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Transaction row: edit and save a category change", async () => {
    await waitFor(element(by.id("transaction-row")).atIndex(0)).toBeVisible().withTimeout(10000);
    await element(by.id("transaction-row")).atIndex(0).tap();

    // tapReturnKey(), not straight into the next tap: transaction-edit-
    // payee-input is autoFocus (see TransactionRow.tsx), so the software
    // keyboard is already up the moment edit mode opens. A real run hit
    // exactly the same class of issue this caused in the Rules engine
    // test (see its own tapReturnKey() comment above) -- the very next
    // tap can get eaten as a keyboard dismiss instead of reaching the
    // button underneath, so the picker never opens.
    await element(by.id("transaction-edit-payee-input")).tapReturnKey();
    await element(by.id("transaction-edit-category-button")).tap();
    // by.id, not by.text("Miscellaneous"): a real run showed that text
    // matching 8 views at once -- every already-categorized transaction
    // row's own category badge reads "Miscellaneous" too, not just the
    // picker option -- see PickerModal.tsx's header comment.
    await element(by.id("picker-option-Miscellaneous")).tap();
    await element(by.id("transaction-edit-save-button")).tap();

    // Waiting for the (post-save, non-editing) category badge to actually
    // read "Miscellaneous" is a positive signal that both the save
    // completed AND edit mode closed -- no need to separately wait for
    // the edit UI to disappear.
    await waitFor(element(by.id("transaction-category-badge")).atIndex(0))
      .toHaveText("Miscellaneous")
      .withTimeout(10000);
    await captureScreen("transaction-edited");
  });

  it("Transaction row: Cancel discards edits without saving", async () => {
    await waitFor(element(by.id("transaction-row")).atIndex(0)).toBeVisible().withTimeout(10000);
    await element(by.id("transaction-row")).atIndex(0).tap();

    await element(by.id("transaction-edit-payee-input")).clearText();
    await element(by.id("transaction-edit-payee-input")).typeText("Should Not Save");
    // tapReturnKey() first -- same keyboard-eats-the-next-tap issue as
    // every other input-then-button sequence in this file (confirmed by a
    // real run: Cancel's tap silently missed, leaving the editor open).
    await element(by.id("transaction-edit-payee-input")).tapReturnKey();
    await element(by.id("transaction-edit-cancel-button")).tap();

    // Back to display mode (the editor itself is gone) and the discarded
    // draft text never made it into the saved row.
    await expect(element(by.id("transaction-edit-payee-input"))).not.toExist();
    await expect(element(by.text("Should Not Save"))).not.toExist();
  });

  it("Account management: add-bank and disconnect banners can be cancelled", async () => {
    await element(by.id("add-bank-button")).tap();
    await expect(element(by.id("add-bank-cancel-button"))).toBeVisible();
    await captureScreen("add-bank-confirm-banner");
    await element(by.id("add-bank-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await expect(element(by.id("disconnect-cancel-button"))).toBeVisible();
    await element(by.id("disconnect-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await element(by.id("disconnect-continue-button")).tap();
    await expect(element(by.id("disconnect-final-cancel-button"))).toBeVisible();
    await captureScreen("disconnect-final-confirm-banner");
    await element(by.id("disconnect-final-cancel-button")).tap();

    // Never taps disconnect-confirm-button -- see this file's header
    // comment on why the real disconnect call is left to Stage 1's mock.
    await expect(element(by.id("linked-account-chip")).atIndex(0)).toBeVisible();
  });

  it("Ask: a suggestion produces a card that can be closed", async () => {
    await element(by.id("tab-ask-button")).tap();
    await expect(element(by.id("ask-input"))).toBeVisible();
    await captureScreen("ask-screen-empty");

    await element(by.id("ask-suggestion")).atIndex(0).tap();
    // A real call to the `query` Edge Function (Anthropic-backed) -- no
    // fixed response to assert on, only that it resolves out of the
    // pending "thinking…" state into a card with a close button.
    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-with-result");
    await element(by.id("query-card-close-button")).tap();

    await element(by.id("tab-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Ask: typing a custom question and pressing Ask produces a result", async () => {
    // The suggestion-chip test above only exercises the canned shortcut
    // path -- ask-button (the actual Send control) was never tapped
    // anywhere in Stage 2 before this.
    await element(by.id("tab-ask-button")).tap();
    await element(by.id("ask-input")).typeText("How much have I spent this month?");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-custom-question");
    await element(by.id("query-card-close-button")).tap();

    // ask-input keeps focus (and the software keyboard) up through the
    // whole exchange -- nothing here ever blurs it. A real run confirmed
    // the keyboard was still covering the bottom tab bar at this point
    // ("Couldn't click at: 269.5,2140.5 ... Tried 3 times" on
    // tab-home-button, and the view hierarchy dump from that failure
    // showed ask-input still focused="true"). tapReturnKey() dismisses it
    // -- input is already "" by now (runQuery clears it on dispatch), so
    // this doesn't re-submit anything.
    await element(by.id("ask-input")).tapReturnKey();
    await element(by.id("tab-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Home: pull-to-refresh doesn't crash and content survives", async () => {
    // Only testable here -- RN's RefreshControl doesn't preserve custom
    // testIDs through ScrollView's native prop handling in Stage 1's JS
    // test renderer (confirmed while building Stage 1's own Home tests),
    // so a real swipe gesture on a real device is the only way to
    // exercise this at all.
    await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(10000);
    await element(by.id("home-transaction-list")).swipe("down", "fast", 0.8);

    await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(10000);
    await expect(element(by.text("Recent Activity"))).toBeVisible();
  });

  it("Sign out returns to the login screen", async () => {
    await element(by.id("sign-out-button")).tap();
    await waitFor(element(by.id("google-signin-button"))).toBeVisible().withTimeout(10000);
  });
});
