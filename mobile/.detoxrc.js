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
      // -PreactNativeArchitectures=x86_64 restricts native compilation to
      // one ABI instead of the default four (armeabi-v7a, arm64-v8a, x86,
      // x86_64, per android/gradle.properties) -- this build only ever
      // runs on Firebase Test Lab's x86_64 virtual devices, so the other
      // three are pure wasted native-compile time. Found by inspecting a
      // real `expo prebuild` output after a first real CI run took over
      // 40 minutes on this step alone.
      build: "cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures=x86_64",
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
