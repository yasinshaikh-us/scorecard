// Shared by every e2e spec that wants a real, viewable screenshot of the
// app (not just Firebase Test Lab's own video, which -- confirmed by
// downloading and inspecting a real run's video.mp4 -- shows Test Lab's
// own "Device Details" backdrop activity the entire time, never the app
// itself; see mobile/README.md's Stage 2 section).
//
// `device.takeScreenshot(name)` alone isn't enough here: per Detox's own
// docs, it returns a temp file path and "schedules" moving it to
// `<artifacts-location>` -- but that relocation is driven by `detox
// test`'s own host-side process over its device connection, which this
// workflow never starts (mobile-detox.yml runs the built APKs directly
// via `gcloud firebase test android run`, deliberately bypassing `detox
// test`'s device orchestration -- see .detoxrc.js's header comment).
// With no host connection, that temp file would just be abandoned
// on-device once the test ends.
//
// Copying it ourselves into /sdcard/Download -- the exact directory
// Google's own Firebase Test Lab docs use in their canonical
// --directories-to-pull example -- is what actually gets it off the
// device: `--directories-to-pull` (see mobile-detox.yml) copies that
// directory's contents into the run's GCS results bucket, the same place
// video.mp4/logcat already come from, which the workflow's existing
// download/upload steps already pick up automatically.
const fs = require("fs");
const path = require("path");

const SCREENSHOT_DIR = "/sdcard/Download/detox-screenshots";

async function captureScreen(name) {
  try {
    const tempPath = await device.takeScreenshot(name);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.copyFileSync(tempPath, path.join(SCREENSHOT_DIR, `${name}.png`));
  } catch (e) {
    // Never let a screenshot failure take down the actual test -- the
    // assertions around it are what prove the app works; this is
    // supplementary visual evidence on top of that.
    console.warn(`captureScreen(${name}) failed -- continuing without it: ${e}`);
  }
}

module.exports = { captureScreen };
