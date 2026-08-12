// `device`, `element`, `by`, `expect` are Detox globals injected by
// detox/runners/jest/testEnvironment (see e2e/jest.config.js) -- not
// imports, matching Detox's own generated test template.
//
// Basic hygiene check: the app launches and a signed-out user sees the
// sign-in screen, not a crash or a blank screen -- the one flow
// automatable without a real session (see testLogin.test.js for the
// authenticated flows, which lean on the test-login bypass instead of
// driving Google's real OAuth screen).
describe("Sign-in screen", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("shows the fa/thm title and the Google sign-in button", async () => {
    await expect(element(by.text("fa/thm"))).toBeVisible();
    await expect(element(by.id("google-signin-button"))).toBeVisible();
  });
});
