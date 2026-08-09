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
module.exports = function withDetoxTestBuildType(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes("testBuildType")) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        testBuildType System.getProperty('testBuildType', 'debug')`
    );
    return config;
  });
};
