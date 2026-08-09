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
describe("Test login", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("signs in as the test account and lands on Home", async () => {
    await element(by.id("test-signin-button")).tap();
    await waitFor(element(by.id("home-screen")))
      .toBeVisible()
      .withTimeout(15000);
    await expect(element(by.text("Recent Activity"))).toBeVisible();
  });
});
