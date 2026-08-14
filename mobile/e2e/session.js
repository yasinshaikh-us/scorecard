// Device/session helpers shared by the Detox specs.
//
// WHY ensureOnHome EXISTS
//
// appFlows.test.js's nine `it()` blocks share one app session set up by a
// single `beforeAll`. That is deliberate (a per-test reinstall costs more
// wall clock than every interaction in the file combined) but it used to
// mean the tests were only independent while they all passed: whatever
// screen a failing test died on -- usually a full-screen modal -- was
// still covering the app when the next test started, so it failed too, and
// so did the one after it. A real run turned ONE bad assertion into nine
// red tests, which makes the report actively misleading: you cannot tell a
// single bug from a broken app without reading every failure.
//
// Calling this from `beforeEach` makes each test start from Home
// regardless of how the previous one ended, so a failure stays one red
// test. The recovery ladder goes cheapest-first, and only reinstalls as a
// last resort, because a reinstall costs ~30s.

// `device`, `element`, `by`, `waitFor` are Detox globals injected by
// detox/runners/jest/testEnvironment (see e2e/jest.config.js).

// Detox has no "is this visible right now" predicate -- every matcher
// throws on no-match -- so probing means catching.
async function isVisible(testID, timeout = 2000) {
  try {
    await waitFor(element(by.id(testID))).toBeVisible().withTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

async function tapIfPresent(testID) {
  try {
    await element(by.id(testID)).tap();
    return true;
  } catch {
    return false;
  }
}

// Waits for whichever signed-in screen appears and ends on Home.
//
// A signed-in session does NOT reliably land on Home: with no linked bank,
// app/(app)/_layout.tsx renders PlaidLinkGate instead, and the account has
// no linked bank most of the time -- globalTeardown.js disconnects the
// Plaid Sandbox item at the END of every run, so that is the state every
// run STARTS in. Specs that waited on `home-screen` alone were therefore
// relying on appFlows/testPlaidLink having run earlier in the same run and
// re-linked a bank for them. That hidden ordering dependency stayed
// invisible while the whole suite always ran together, and broke the
// moment a subset ran on its own.
//
// Polls both landings in short slices rather than waiting out a long
// timeout on one before trying the other, so the common case stays fast.
async function settleOnHome(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isVisible("home-screen", 1000)) return;
    if (await isVisible("plaid-gate-skip-button", 1000)) {
      await tapIfPresent("plaid-gate-skip-button");
      break;
    }
  }
  // Also the fall-through when the deadline expires: assert on home-screen
  // itself so a genuine failure reports the screen it was waiting for
  // rather than a bare polling timeout.
  await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(15000);
}

// Enters text into a field in ONE native operation instead of keystroke
// by keystroke.
//
// WHY NOT typeText
//
// Detox's typeText sends one key event per character. Against a
// CONTROLLED TextInput -- which every input in this app is (`value` plus
// `onChangeText`) -- each keystroke round-trips JS -> native to write the
// controlled value back, and the next keystroke can land before that
// write does. Characters then arrive transposed. Two separate real runs
// caught it on the same field, each a single adjacent swap:
//
//   typed     E2E Renamed Payee
//   run 57    ER2E enamed Payee
//   run 61    E2ER enamed Payee
//
// This is NOT the stale-closure bug fixed in CategoryRulesPanel.tsx.
// That one discarded whole field values, is a real user-facing bug, and
// is covered by a Stage 1 regression test. This is the JS<->native
// ordering race underneath it, which no amount of app-side state
// discipline can remove -- run 61 still hit it with the closure bug
// already fixed.
//
// replaceText sets the whole string at once, so there is no ordering to
// get wrong. Nothing is lost by not simulating per-keystroke input here:
// the onChangeText path is driven directly and deterministically at
// Stage 1, where it belongs, rather than through a real soft keyboard.
//
// The tap/dismiss bracket is deliberate and load-bearing. This file's
// history is a series of fixes for Android's soft keyboard eating the
// NEXT tap (see appFlows.test.js's tapReturnKey comments). Tapping first
// guarantees focus so the dismissal has something to dismiss; the
// dismissal is tolerant because replaceText does not reliably raise the
// keyboard at all, and failing to dismiss a keyboard that was never up
// must not fail a test.
async function setInputText(testID, text) {
  await element(by.id(testID)).tap();
  await element(by.id(testID)).replaceText(text);
  try {
    await element(by.id(testID)).tapReturnKey();
  } catch {
    // No keyboard to dismiss.
  }
}

// Launches the app and gets to Home, tolerating every entry state: a
// retained session lands on Home (or the gate), a cleared one starts at
// the login screen.
//
// 30s waits, not 8-10s: a cold install plus a real Supabase auth
// round-trip is slow on a resource-constrained CI emulator (see
// testLogin.test.js's comment on the same number).
async function launchAndSignIn({ reinstall = false } = {}) {
  await device.launchApp({ newInstance: true, delete: reinstall });

  if (await isVisible("home-screen", 5000)) return;

  await tapIfPresent("test-signin-button");
  await settleOnHome(30000);
}

// Returns the app to Home from wherever the previous test left it.
// Cheapest recovery first; each rung only runs if the one before it did
// not already land on Home.
async function ensureOnHome() {
  if (await isVisible("home-screen")) return;

  // 1. Dismiss whatever is on top. A modal is by far the most common way
  //    a failed test leaves the app: the Rules Engine panel, an Ask result
  //    card, or a picker sheet. These are no-ops when not present.
  for (const dismissId of ["picker-cancel-button", "rules-close-button", "query-card-close-button"]) {
    await tapIfPresent(dismissId);
  }
  if (await isVisible("home-screen")) return;

  // 2. Still not Home -- most likely parked on the Ask tab.
  await tapIfPresent("nav-home-button");
  if (await isVisible("home-screen", 5000)) return;

  // 3. Signed out, crashed, or wedged. A relaunch without `delete` keeps
  //    the install (and any retained session), so this is still far
  //    cheaper than the full reinstall below.
  await launchAndSignIn({ reinstall: false });
  if (await isVisible("home-screen", 5000)) return;

  // 4. Last resort.
  await launchAndSignIn({ reinstall: true });
}

// Scrolls Home's list until `testID` is on screen, then leaves it there.
//
// Needed because the Banks block is now a row per linked account rather
// than a horizontal strip, and the Plaid Sandbox test item seeds twelve
// accounts -- so Recent Activity starts well below the fold on CI, and a
// bare toBeVisible() on the first transaction row fails Espresso's
// 75%-visible rule without the app being broken. Real users have two or
// three accounts; the emulator is the worst case, which is exactly what
// this suite should be exercising.
async function scrollIntoView(testID, listID = "home-transaction-list", index = 0) {
  await waitFor(element(by.id(testID)).atIndex(index))
    .toBeVisible()
    .whileElement(by.id(listID))
    .scroll(400, "down");
}

module.exports = { isVisible, tapIfPresent, setInputText, settleOnHome, launchAndSignIn, ensureOnHome, scrollIntoView };
