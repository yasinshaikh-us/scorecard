// `device`, `element`, `by`, `expect`, `waitFor` are Detox globals
// injected by detox/runners/jest/testEnvironment (see e2e/jest.config.js).
//
// Exercises the test-login path end to end: tapping "Sign in as test
// user" (see app/login.tsx, only rendered when EXPO_PUBLIC_ENABLE_TEST_LOGIN
// is set -- true for this build) calls the supabase/functions/test-login
// Edge Function and lands on Home with a real session, all without
// touching Google's OAuth screen. This is the one thing that could not be
// verified from the sandbox that built it (no way to curl the Edge
// Function directly, no device to tap the button on) -- this spec is its
// first real end-to-end check.
const { captureScreen } = require("./screenshot");
const { settleOnHome, isVisible, tapIfPresent } = require("./session");

describe("Test login", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("signs in as the test account and lands on Home", async () => {
    await captureScreen("login-screen");
    await element(by.id("test-signin-button")).tap();
    // 30s, not 15s: a cold install + real Supabase auth round-trip on a
    // resource-constrained CI emulator (software GPU rendering, shared
    // CPU) is slower than on a real device -- 15s wasn't enough headroom
    // (confirmed on a real run: testLogin/testPlaidLink both timed out
    // here identically while smoke.test.js, which needs no sign-in,
    // passed comfortably).
    //
    // settleOnHome, not a bare wait on home-screen: a signed-in session
    // lands on PlaidLinkGate rather than Home when the account has no
    // linked bank, which -- because globalTeardown.js disconnects the
    // Sandbox item at the end of every run -- is the state every run
    // begins in. Waiting on home-screen alone quietly depended on
    // appFlows/testPlaidLink having re-linked a bank earlier in the SAME
    // run, so this spec passed in the full suite and timed out the first
    // time it ran as part of a subset. See e2e/session.js.
    await settleOnHome(30000);
    // Matched by testID, not by.text("Recent Activity") -- text matching
    // against a TextView inside a FlatList's ListHeaderComponent proved
    // genuinely unreliable on the real emulator: two separate CI runs
    // timed out here (10s and even 30s) while a failure screenshot taken
    // at the exact instant of the timeout showed "Recent Activity" fully
    // rendered and visible on screen the whole time (confirmed via
    // Supabase Edge Function / PostgREST logs too -- the underlying data
    // fetch completed in 150-350ms, long before either timeout). So the
    // data and the render were both fine; only Espresso's text-content
    // matcher against the FlatList-hosted TextView was failing to confirm
    // it. Matching by testID sidesteps that class of RecyclerView/Fabric
    // text-matching flakiness the same way home-screen's own testID-based
    // wait above never had this problem.
    await waitFor(element(by.id("recent-activity-header")))
      .toBeVisible()
      .withTimeout(10000);
    await captureScreen("home-screen-after-login");
  });

  it("session persists across a real app relaunch, not just in-memory state", async () => {
    // newInstance: true without delete: true -- kills and restarts the app
    // process (clearing all in-memory JS state) while leaving the already-
    // installed app's on-disk storage alone, so this genuinely exercises
    // the real encrypted session round-trip: lib/supabase.ts's
    // LargeSecureStore decrypts the AsyncStorage-held session blob using
    // an AES key read back from SecureStore. Stage 1 mocks the whole
    // supabase module at the boundary, so a broken encrypt/decrypt round
    // trip is invisible there -- this exact class of bug silently broke
    // every real sign-in once before (see LargeSecureStore's own comment
    // in lib/supabase.ts), and nothing anywhere in the pyramid has
    // regression-tested it since.
    await device.launchApp({ newInstance: true });

    // Reaching ANY signed-in screen is what proves the session survived --
    // Home, or PlaidLinkGate when the account has no linked bank (see the
    // first test's comment on why that is the normal state). The absence
    // of the Google button is the half that proves it: being bounced back
    // to /login is the failure this test exists to catch.
    const signedIn = (await isVisible("home-screen", 15000)) || (await isVisible("plaid-gate-skip-button", 15000));
    await expect(element(by.id("google-signin-button"))).not.toExist();
    if (!signedIn) {
      throw new Error("Session did not survive the relaunch: neither Home nor PlaidLinkGate appeared");
    }

    await tapIfPresent("plaid-gate-skip-button");
    await waitFor(element(by.id("home-screen"))).toBeVisible().withTimeout(30000);
    await captureScreen("home-screen-after-relaunch");
  });
});
