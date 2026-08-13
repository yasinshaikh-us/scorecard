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
  await tapIfPresent("tab-home-button");
  if (await isVisible("home-screen", 5000)) return;

  // 3. Signed out, crashed, or wedged. A relaunch without `delete` keeps
  //    the install (and any retained session), so this is still far
  //    cheaper than the full reinstall below.
  await launchAndSignIn({ reinstall: false });
  if (await isVisible("home-screen", 5000)) return;

  // 4. Last resort.
  await launchAndSignIn({ reinstall: true });
}

module.exports = { isVisible, tapIfPresent, settleOnHome, launchAndSignIn, ensureOnHome };
