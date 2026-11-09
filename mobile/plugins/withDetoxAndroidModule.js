const { withSettingsGradle, withAppBuildGradle } = require("@expo/config-plugins");

// Detox's Android native library (the actual Espresso-driven bridge that
// e2e/*.test.js talks to over a websocket -- see .detoxrc.js's header
// comment) lives in node_modules/detox/android/detox as a local Gradle
// module, not a published Maven artifact. Bare React Native's `detox init`
// wires it in by editing the project's committed android/settings.gradle
// and android/app/build.gradle directly; Expo's prebuild regenerates both
// files from scratch every time (nothing is committed there), and neither
// gets this wiring by default, so it has to be injected here the same way
// withDetoxTestBuildType.js injects testBuildType/testInstrumentationRunner.
//
// Without this, androidx.test.runner.AndroidJUnitRunner -- the very class
// testInstrumentationRunner now points at -- isn't actually resolvable on
// the androidTest APK's classpath at all: confirmed on a real run
// (mobile-detox.yml run 31455920629) via a hard instrumentation crash,
// `java.lang.ClassNotFoundException: Didn't find class
// "androidx.test.runner.AndroidJUnitRunner"`, with a DexPathList dump
// showing only system framework jars plus the app/test APKs themselves --
// no Detox module, no androidx.test artifacts anywhere on it.
//
// The :detox module itself publishes two product flavors under a "detox"
// dimension (full / coreNative -- see node_modules/detox/android/detox/
// build.gradle). This app doesn't declare that dimension itself, so a bare
// `project(':detox')` reference is ambiguous to Gradle -- confirmed on a
// real run (31456664934): `Could not resolve project :detox ... cannot
// choose between coreNativeReleaseApiElements / fullReleaseApiElements`.
// missingDimensionStrategy is Android Gradle Plugin's standard mechanism
// for exactly this case -- telling Gradle which flavor to pick for any
// dependency that has a dimension this project doesn't itself use. "full"
// is the flavor with Detox's actual JS-facing bridge (vs. "coreNative",
// a lighter native-only variant), which is what's needed here.
module.exports = function withDetoxAndroidModule(config) {
  config = withSettingsGradle(config, (config) => {
    if (config.modResults.contents.includes("include ':detox'")) return config;
    config.modResults.contents +=
      "\ninclude ':detox'\n" +
      "project(':detox').projectDir = new File(rootDir, '../node_modules/detox/android/detox')\n";
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("missingDimensionStrategy 'detox'")) {
      config.modResults.contents = config.modResults.contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        missingDimensionStrategy 'detox', 'full'`
      );
    }
    if (!config.modResults.contents.includes("project(':detox')")) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    androidTestImplementation project(':detox')`
      );
    }
    return config;
  });
};
