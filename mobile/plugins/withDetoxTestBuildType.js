const { withAppBuildGradle } = require("@expo/config-plugins");

// Detox's Android build (see .detoxrc.js) passes -DtestBuildType=release so
// the androidTest APK instruments the same build type as the app APK it's
// packaged alongside -- otherwise `assembleAndroidTest` always targets the
// debug variant regardless of which app build type was actually compiled,
// and Firebase Test Lab ends up trying to run a mismatched pair of APKs.
// Bare React Native's community template wires this `testBuildType` line in
// by default; Expo's prebuild template doesn't, so it has to be injected
// here -- confirmed by inspecting a real `expo prebuild` output, since
// nothing in Expo's own docs calls this gap out.
//
// testInstrumentationRunner is the same story: bare RN's community template
// sets it to androidx.test.runner.AndroidJUnitRunner by default; Expo's
// template leaves it unset, so the OS silently falls back to the ancient,
// deprecated android.test.InstrumentationTestRunner. Detox's native Android
// library needs the JUnit4-based AndroidJUnitRunner to bootstrap its
// Espresso-driven bridge -- without it, `pm list instrumentation` reports
// android.test.InstrumentationTestRunner instead (confirmed on a real run,
// mobile-detox.yml run 31454483324), which spends its whole time doing a
// slow JUnit3-style reflective classpath scan across the entire APK (every
// class, including unrelated Compose UI internals) hunting for test-suite
// classes by naming convention, and never gets anywhere near starting
// Detox's own bridge -- so every spec's device.launchApp() call in
// beforeAll just times out waiting for a "ready" message that was never
// going to come.
module.exports = function withDetoxTestBuildType(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes("testBuildType")) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        testBuildType System.getProperty('testBuildType', 'debug')\n        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"`
    );
    return config;
  });
};
