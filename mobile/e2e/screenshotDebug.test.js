// Throwaway diagnostic, not part of the real suite -- isolates exactly
// one question: does device.takeScreenshot() + fs.copyFileSync() to
// /sdcard/Download/detox-screenshots actually work in this project's
// host-less execution mode (gcloud firebase test android run directly,
// no `detox test` process -- see .detoxrc.js)? appFlows.test.js's first
// real run produced zero screenshots with no diagnostic trace in logcat,
// so this skips sign-in/network calls entirely and asserts loudly at
// every step instead of swallowing errors, so a failure shows up with a
// real stack trace in test_result_1.xml/instrumentation.results --
// evidence that doesn't depend on figuring out where Detox's on-device
// console output actually goes.
//
// e2e/jest.config.js's testMatch is temporarily pointed at ONLY this
// file for this diagnostic run, skipping smoke/testLogin/testPlaidLink/
// appFlows entirely (no real sign-in, no Plaid Sandbox link, no Ask LLM
// call) -- that's what keeps this run to a couple of minutes of device
// time instead of the ~8 the full suite takes, on top of the same fixed
// ~5min Gradle build every run needs regardless.
const fs = require("fs");

describe("Screenshot debug", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it("captures and saves a real screenshot", async () => {
    await waitFor(element(by.id("google-signin-button"))).toBeVisible().withTimeout(15000);

    const tempPath = await device.takeScreenshot("debug");
    console.log(`DEBUG: takeScreenshot returned tempPath=${tempPath}`);

    const dir = "/sdcard/Download/detox-screenshots";
    fs.mkdirSync(dir, { recursive: true });
    const dest = `${dir}/debug.png`;
    fs.copyFileSync(tempPath, dest);

    const stat = fs.statSync(dest);
    console.log(`DEBUG: copied screenshot to ${dest}, size=${stat.size} bytes`);

    expect(stat.size).toBeGreaterThan(0);
  });
});
