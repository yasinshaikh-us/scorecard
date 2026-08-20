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
// one shared Sandbox-bank seed, reused across every `it()` below via a
// single `beforeAll`, keeps this file's cost close to one more sign-in +
// one more seed on top of testLogin.test.js / testPlaidLink.test.js,
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
// This file used to ASSUME the shared test account held no other
// category_rules at the start of a run, and matched rows positionally
// (`.atIndex(0)`, "No rules yet.") on the strength of that assumption. The
// assumption was violated by the suite's own failure mode: a spec that
// died before its cleanup left its rule behind, so the next run's
// `.atIndex(0)` deleted the LEFTOVER instead of the row it had just
// created and failed too -- forever, until someone cleared the table by
// hand. One flake became a permanently red suite (mobile-detox.yml runs 57
// and 57/attempt-2).
//
// Nothing is assumed any more. e2e/globalSetup.js wipes every leftover
// "e2e-*" rule before the device boots; each rule created here is
// namespaced to the current run; afterEach removes them even when a test
// throws; and rows are addressed by identity (`rule-*-${value}` testIDs,
// see CategoryRulesPanel.tsx) rather than by position, so an unexpected
// row can no longer misdirect a tap.
const { captureScreen } = require("./screenshot");
const { runScopedRuleValue, cleanupThisRunsRules } = require("./testAccount");
const { launchAndSignIn, ensureOnHome, setInputText, scrollIntoView } = require("./session");

// Namespaced per run, so a Stage 2 job running concurrently on another ref
// cannot collide with these and afterEach can delete exactly what this run
// created -- nothing more.
const CATEGORY_RULE_VALUE = runScopedRuleValue("cat");
const PAYEE_RULE_VALUE = runScopedRuleValue("payee");
const RENAMED_PAYEE = "E2E Renamed Payee";

describe("App flows (Rules, transactions, accounts, navigation, Ask)", () => {
  beforeAll(async () => {
    // The linked account these tests need (for the account-management
    // banners below) and its transactions (Home's Recent Activity is
    // anchored to the ledger's OWN latest date, so whatever is seeded is
    // always "recent" -- see app/(app)/home.tsx's daysBefore comment) are
    // seeded by e2e/globalSetup.js, before the emulator is even booted.
    //
    // Deliberately NOT seeded here. Doing it in this hook put ~12s of
    // network I/O between the cold boot and the app reaching the
    // foreground, and the launcher ANR'd in that window -- taking every
    // spec in the run down with it. See globalSetup.js for the full
    // account. Launching the app is the first thing this hook does, and
    // should stay that way.
    //
    // Handles every entry state (retained session, login screen, or a
    // fresh account stopping at PlaidLinkGate) -- see e2e/session.js.
    await launchAndSignIn({ reinstall: true });

    // .atIndex(0), not a bare id match: Plaid Sandbox's "First Platypus
    // Bank" test institution (see test-plaid-link/index.ts) returns its
    // whole account portfolio -- checking, savings, CD, and more -- not
    // just one account, so several linked-account-row views are always
    // on screen at once by design (confirmed via a real run: exactly one
    // plaid_items row, freshly created, with 12 accounts under it -- this
    // is expected Sandbox data, not accumulated cruft from prior runs).
    //
    // The 30s wait is not slack. AccountBalances renders just an
    // ActivityIndicator ("Loading…") until its own real balances fetch
    // resolves, and home-screen being visible doesn't mean that fetch has
    // finished -- a real run failed here with the hierarchy dump still
    // showing "Loading…", once the shared account's dataset had grown
    // enough across runs to slow that fetch down.
    await waitFor(element(by.id("linked-account-row")).atIndex(0)).toBeVisible().withTimeout(30000);
    await captureScreen("home-with-linked-account");
  });

  // Every test starts from Home regardless of how the previous one ended.
  // Without this, a test that died with a modal open left that modal
  // covering the app for every test after it -- one bad assertion reported
  // as nine failures, which hides the actual cause rather than surfacing
  // it. See e2e/session.js for the recovery ladder.
  beforeEach(async () => {
    await ensureOnHome();
  });

  // Deliberately here and not at the end of each test body: cleanup that
  // lives in the body is skipped by a failing assertion, which is exactly
  // how a rule got orphaned in the first place. afterEach runs either way.
  //
  // Non-fatal: a cleanup blip must not turn an otherwise-passing test red
  // (that would just trade one flake source for another). Anything left
  // behind is swept by the next run's globalSetup, and nothing here
  // depends on the table being empty any more.
  afterEach(async () => {
    try {
      await cleanupThisRunsRules();
    } catch (err) {
      console.warn(`[e2e-cleanup] could not remove this run's rules -- next run's reset will: ${err}`);
    }
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

    // setInputText, not typeText + tapReturnKey: it sets the value in one
    // native operation (no per-keystroke transposition race -- see
    // e2e/session.js) while keeping the tap-to-focus/dismiss bracket that
    // this file needs. That bracket is why the keystrokes were split from
    // the next tap in the first place: a real run showed the soft keyboard
    // still up and the match-value text mid-typed at the moment "set
    // category to" was tapped, so Android ate that tap as a dismiss and
    // the picker never opened. A Stage 1 render of the same tap sequence
    // confirmed the component's own state logic opens the picker
    // correctly, so that was real-device keyboard timing, not an app bug.
    await setInputText("rule-match-value-input", CATEGORY_RULE_VALUE);
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
    // Addressed by this rule's own match_value, not `.atIndex(0)`: the
    // assertion now proves THIS rule was created, and stays correct no
    // matter what else is in the list.
    await waitFor(element(by.id(`rule-switch-toggle-${CATEGORY_RULE_VALUE}`)))
      .toBeVisible()
      .withTimeout(10000);
    await captureScreen("rules-engine-with-rule");

    // Toggling round-trips through a real DB update + apply_category_rules()
    // RPC -- the "Applied to N transaction(s)." status text is proof both
    // calls actually completed, not just that the tap didn't crash.
    await element(by.id(`rule-switch-toggle-${CATEGORY_RULE_VALUE}`)).tap();
    await waitFor(element(by.id("rules-status"))).toBeVisible().withTimeout(10000);

    await element(by.id(`rule-delete-button-${CATEGORY_RULE_VALUE}`)).tap();
    await expect(element(by.text("Delete this rule?"))).toBeVisible();
    await element(by.id("rule-delete-cancel-button")).tap();
    await expect(element(by.id(`rule-switch-toggle-${CATEGORY_RULE_VALUE}`))).toBeVisible();

    await element(by.id(`rule-delete-button-${CATEGORY_RULE_VALUE}`)).tap();
    await element(by.id("rule-delete-confirm-button")).tap();
    // "this row is gone", not "the list is empty" -- the old
    // "No rules yet." wait asserted something about the whole account
    // rather than about this test's own rule, so any unrelated row (a
    // leftover, or a concurrent run's) failed it.
    await waitFor(element(by.id(`rule-row-${CATEGORY_RULE_VALUE}`)))
      .not.toExist()
      .withTimeout(10000);

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
    // rule-set-payee-input is the field that transposed characters under
    // typeText on two separate runs -- see e2e/session.js's setInputText.
    await setInputText("rule-match-value-input", PAYEE_RULE_VALUE);
    await setInputText("rule-set-payee-input", RENAMED_PAYEE);

    await element(by.id("add-rule-button")).tap();
    // Still a text assertion, deliberately: this is the one place that
    // proves the " → payee X" rendering branch itself is correct, which a
    // testID match would not. It is also the assertion that caught the
    // stale-closure bug in CategoryRulesPanel's inputs -- a real run typed
    // "E2E Renamed Payee" and this read back "ER2E enamed Payee" (now
    // fixed, and covered by a Stage 1 regression test).
    await waitFor(element(by.text(`if payee contains "${PAYEE_RULE_VALUE}" → payee ${RENAMED_PAYEE}`)))
      .toBeVisible()
      .withTimeout(10000);
    await captureScreen("rules-engine-payee-rule");

    await element(by.id(`rule-delete-button-${PAYEE_RULE_VALUE}`)).tap();
    await element(by.id("rule-delete-confirm-button")).tap();
    await waitFor(element(by.id(`rule-row-${PAYEE_RULE_VALUE}`)))
      .not.toExist()
      .withTimeout(10000);

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
      .toHaveLabel("Category: Miscellaneous")
      .withTimeout(10000);
    await captureScreen("transaction-edited");
  });

  it("Transaction row: Cancel discards edits without saving", async () => {
    await waitFor(element(by.id("transaction-row")).atIndex(0)).toBeVisible().withTimeout(10000);
    await element(by.id("transaction-row")).atIndex(0).tap();

    // setInputText replaces the field's whole contents, so the separate
    // clearText() is no longer needed. It also keeps the dismiss-before-
    // tap bracket this line has always needed: the same
    // keyboard-eats-the-next-tap issue as every other input-then-button
    // sequence here (a real run had Cancel's tap silently miss, leaving
    // the editor open).
    //
    // Worth doing even though a scrambled value could not fail the
    // assertion below (it checks the text is ABSENT, so a transposed
    // string would pass vacuously) -- that is exactly what makes it worth
    // fixing: the test would have kept reporting green while no longer
    // testing what it claims to.
    await setInputText("transaction-edit-payee-input", "Should Not Save");
    await element(by.id("transaction-edit-cancel-button")).tap();

    // Back to display mode (the editor itself is gone) and the discarded
    // draft text never made it into the saved row.
    await expect(element(by.id("transaction-edit-payee-input"))).not.toExist();
    await expect(element(by.text("Should Not Save"))).not.toExist();
  });

  it("Account management: add-bank and disconnect banners can be cancelled", async () => {
    await element(by.id("add-bank-button")).tap();
    await scrollIntoView("add-bank-cancel-button");
    await captureScreen("add-bank-confirm-banner");
    await element(by.id("add-bank-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await scrollIntoView("disconnect-cancel-button");
    await element(by.id("disconnect-cancel-button")).tap();

    await element(by.id("disconnect-button")).atIndex(0).tap();
    await element(by.id("disconnect-continue-button")).tap();
    await scrollIntoView("disconnect-final-cancel-button");
    await captureScreen("disconnect-final-confirm-banner");
    await element(by.id("disconnect-final-cancel-button")).tap();

    // Never taps disconnect-confirm-button -- see this file's header
    // comment on why the real disconnect call is left to Stage 1's mock.
    await expect(element(by.id("linked-account-row")).atIndex(0)).toBeVisible();
  });

  // Stage 2 screenshots the Ask card but asserted nothing about what is
  // in it, which made every element added above the chart -- the total,
  // the count, the span -- invisible to this stage. A screenshot only
  // helps someone who looks at it; an assertion fails the run.
  //
  // Deliberately only the parts that do NOT depend on which spec Claude
  // picks: a result with rows always renders the stat block, whatever
  // chart type or grouping the model chose. Asserting a legend or a
  // projected note here would be asserting a model's judgement, which is
  // how a UI test becomes a coin flip.
  it("Ask: a result leads with the total, the count and the span", async () => {
    await element(by.id("nav-ask-button")).tap();
    await setInputText("ask-input", "How much have I spent on groceries this year?");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await waitFor(element(by.id("query-stats"))).toBeVisible().withTimeout(5000);
    await expect(element(by.id("query-stat-total"))).toBeVisible();
    await expect(element(by.id("query-stat-count"))).toBeVisible();
    await expect(element(by.id("query-stat-average"))).toBeVisible();
    await captureScreen("ask-screen-stats");

    await element(by.id("query-card-close-button")).tap();
    await element(by.id("nav-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  // The list used to mount every matching row -- thousands of them on
  // this account. The cap is only observable on a question broad enough
  // to exceed it, which is why this asks for everything.
  it("Ask: a broad question caps the list instead of rendering the whole ledger", async () => {
    await element(by.id("nav-ask-button")).tap();
    await setInputText("ask-input", "List every transaction from the last twelve months");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    // Scrolled into view rather than asserted flat: the cap note sits
    // below 200 rows of list.
    await scrollIntoView("query-row-cap", "ask-feed");
    await expect(element(by.id("query-row-cap"))).toBeVisible();
    await captureScreen("ask-screen-row-cap");

    await element(by.id("nav-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Ask: a suggestion produces a card that can be closed", async () => {
    await element(by.id("nav-ask-button")).tap();
    await expect(element(by.id("ask-input"))).toBeVisible();
    await captureScreen("ask-screen-empty");

    await element(by.id("ask-suggestion")).atIndex(0).tap();
    // A real call to the `query` Edge Function (Anthropic-backed) -- no
    // fixed response to assert on, only that it resolves out of the
    // pending "thinking…" state into a card with a close button.
    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-with-result");
    await element(by.id("query-card-close-button")).tap();

    await element(by.id("nav-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  it("Ask: typing a custom question and pressing Ask produces a result", async () => {
    // The suggestion-chip test above only exercises the canned shortcut
    // path -- ask-button (the actual Send control) was never tapped
    // anywhere in Stage 2 before this.
    await element(by.id("nav-ask-button")).tap();
    // Deliberately still typeText, unlike the rule/transaction inputs
    // above. This spec depends on ask-input keeping focus and the keyboard
    // staying UP through the whole exchange (see the tapReturnKey comment
    // at the end of this test), which setInputText's dismiss bracket would
    // undo. A transposed question here also cannot fail anything -- the
    // assertion is that a result card comes back, and it would for any
    // string -- so there is nothing to gain against a real risk of
    // breaking the keyboard sequencing this test needs.
    await element(by.id("ask-input")).typeText("How much have I spent this month?");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-custom-question");
    await element(by.id("query-card-close-button")).tap();

    // ask-input keeps focus (and the software keyboard) up through the
    // whole exchange -- nothing here ever blurs it. A real run confirmed
    // the keyboard was still covering the bottom tab bar at this point
    // ("Couldn't click at: 269.5,2140.5 ... Tried 3 times" on the
    // then-bottom Home tab, and the view hierarchy dump from that failure
    // showed ask-input still focused="true"). The navigation control has
    // since moved into the header, well clear of any keyboard, so that
    // specific collision can't recur -- but tapReturnKey() is kept
    // because leaving a screen with the keyboard still up is what made
    // the *next* test's first tap land unpredictably. input is already ""
    // by now (runQuery clears it on dispatch), so this re-submits nothing.
    await element(by.id("ask-input")).tapReturnKey();
    await element(by.id("nav-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  // The question above produces a VERTICAL chart, which is the only kind
  // Stage 2 ever screenshotted -- and horizontal is the orientation that
  // was broken. gifted-charts transposes width/height when `horizontal`
  // is set (see Chart.tsx), so a ranking rendered rotated in its own box:
  // overflowing the card sideways while padding it out with most of a
  // blank screen vertically. Every assertion passed throughout, because
  // the card and its rows were present and visible the whole time. Only a
  // screenshot shows it, which is the entire reason this exists.
  //
  // Asserting only that a card comes back, deliberately: the question is
  // interpreted by Claude in the `query` Edge Function, so which chart
  // type it picks is not something a UI test should be made to depend on.
  // A ranking is what this phrasing reliably yields, and the screenshot is
  // what's actually being inspected.
  it("Ask: a ranking question renders its horizontal chart inside the card", async () => {
    await element(by.id("nav-ask-button")).tap();
    await setInputText("ask-input", "Top 10 expenses this month");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-horizontal-ranking");
    await element(by.id("query-card-close-button")).tap();

    await element(by.id("nav-home-button")).tap();
    await expect(element(by.id("home-screen"))).toBeVisible();
  });

  // The chart's other failure mode, and the one only a screenshot shows:
  // a DATE grouping over a long span. gifted-charts sizes bars in fixed
  // pixels, so a series longer than the card was drawn past its right
  // edge and turned the plot into a horizontal scroller -- data you had
  // to swipe to reach, in a card that gives no hint there is more. The
  // same screenshot is the check on the other two axis changes: x labels
  // that name periods ("1 Aug '26", then bare day numbers) instead of
  // repeating a full date under every bar, and y gridlines on round money
  // rather than on quarters of the data maximum.
  //
  // Asserting only that a card comes back, same as the ranking spec
  // above: which chart type Claude picks is not something a UI test
  // should depend on. Any date grouping over this span exercises the
  // geometry, and the screenshot is what is actually being inspected.
  it("Ask: a long date range renders its chart inside the card", async () => {
    await element(by.id("nav-ask-button")).tap();
    await setInputText("ask-input", "Show my spending by day over the last 3 months");
    await element(by.id("ask-button")).tap();

    await waitFor(element(by.id("query-card-close-button"))).toBeVisible().withTimeout(20000);
    await captureScreen("ask-screen-long-date-range");
    await element(by.id("query-card-close-button")).tap();

    await element(by.id("nav-home-button")).tap();
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
    // Matched by testID -- see testLogin.test.js's identical wait for why:
    // text matching against a TextView inside a FlatList's
    // ListHeaderComponent proved genuinely unreliable on the real
    // emulator (a failure screenshot taken at the exact instant of a
    // timeout here showed "Recent Activity" fully rendered and visible
    // the whole time), not a repaint-timing issue.
    await waitFor(element(by.id("recent-activity-header"))).toBeVisible().withTimeout(10000);
  });

  it("Sign out returns to the login screen", async () => {
    await element(by.id("sign-out-button")).tap();
    await waitFor(element(by.id("google-signin-button"))).toBeVisible().withTimeout(10000);
  });
});
