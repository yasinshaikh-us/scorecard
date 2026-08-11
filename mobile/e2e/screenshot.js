// Shared by every e2e spec that wants a real, viewable screenshot of the
// app. `device.takeScreenshot(name)` alone is enough now that `detox
// test` actually drives the device (see .detoxrc.js's header comment
// for why that wasn't true before) -- Detox's own artifact system
// relocates the result to <artifacts-location> when the test completes
// (mobile-detox.yml's `--artifacts-location`/`--take-screenshots`
// flags), which the workflow's upload step then hands over as a GitHub
// Actions artifact.
async function captureScreen(name) {
  try {
    await device.takeScreenshot(name);
  } catch (e) {
    // Never let a screenshot failure take down the actual test -- the
    // assertions around it are what prove the app works; this is
    // supplementary visual evidence on top of that.
    console.warn(`captureScreen(${name}) failed -- continuing without it: ${e}`);
  }
}

module.exports = { captureScreen };
