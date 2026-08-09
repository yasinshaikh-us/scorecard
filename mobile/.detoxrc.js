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
      build: "cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release",
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
