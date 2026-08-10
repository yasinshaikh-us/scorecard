/** @type {Detox.DetoxConfig} */
// Detox only builds the app + androidTest APKs here (`detox build`) --
// running them is handed off to Firebase Test Lab directly via `gcloud
// firebase test android run` (see .github/workflows/mobile-detox.yml),
// not to `detox test`'s own device orchestration, since there's no
// emulator/device available in either this repo's CI or the sandbox that
// authored it. The `devices`/`configurations` blocks below exist only
// because `detox build` requires a well-formed config to parse --
// they're never actually used to launch anything.
//
// android/ is generated fresh by `expo prebuild` in CI, not committed --
// see plugins/withDetoxTestBuildType.js for the one native tweak that
// requires (Expo's prebuild template doesn't wire up the `testBuildType`
// property bare React Native's community template does, which Detox's
// release-mode Android testing depends on).
module.exports = {
  testRunner: {
    args: {
      $0: "jest",
      config: "e2e/jest.config.js",
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    "android.release": {
      type: "android.apk",
      binaryPath: "android/app/build/outputs/apk/release/app-release.apk",
      // -PreactNativeArchitectures restricts native compilation to one ABI
      // instead of the default four (armeabi-v7a, arm64-v8a, x86, x86_64,
      // per android/gradle.properties) -- building all four is pure wasted
      // native-compile time when only one will ever actually run. Originally
      // x86_64 (mobile-detox.yml run 31290582438's first real CI attempt
      // took 40+ min on this step with all four ABIs), matching the
      // workflow's then-hardcoded model=Pixel2 device (an x86_64 emulator).
      // Switched to arm64-v8a after PR #85 replaced that hardcoded model
      // with a live catalog lookup, which now consistently picks
      // AndroidTablet270dpi.arm -- run 31344289584 confirmed a real x86_64
      // build fails on that device with "Test is Incompatible Architecture"
      // (App architecture or requested options are incompatible with this
      // device), meaning Firebase Test Lab's current virtual device catalog
      // has shifted to ARM.
      build: "cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures=arm64-v8a",
    },
  },
  devices: {
    emulator: {
      type: "android.emulator",
      device: {
        avdName: "Pixel_3a_API_30_x86",
      },
    },
  },
  configurations: {
    "android.release": {
      device: "emulator",
      app: "android.release",
    },
  },
};
