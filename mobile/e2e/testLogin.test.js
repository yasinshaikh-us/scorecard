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
    await waitFor(element(by.id("home-screen")))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text("Recent Activity"))).toBeVisible();
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
    await waitFor(element(by.id("home-screen")))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id("google-signin-button"))).not.toExist();
    await captureScreen("home-screen-after-relaunch");
  });
});
