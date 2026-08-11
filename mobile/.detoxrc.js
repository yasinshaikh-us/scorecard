/** @type {Detox.DetoxConfig} */
// `detox build` compiles the app + androidTest APKs; `detox test` then
// runs the real Jest/JS test files against a real, running Android
// emulator, driving it via Detox's own host-to-device connection (see
// .github/workflows/mobile-detox.yml's "Run Detox tests on a real
// Android emulator" step, which boots one directly on the GitHub
// Actions runner via reactivecircus/android-emulator-runner).
//
// This replaces an earlier design that handed the built APKs straight
// to `gcloud firebase test android run`, bypassing `detox test`
// entirely. That seemed to work (Firebase Test Lab reported "Passed"
// run after run) but was a false positive the whole time: Detox's
// androidTest APK is just a thin bridge with no JS test logic baked
// in -- the actual test code only ever runs on the *host* machine
// (`detox test`'s own Jest process), which drives the on-device bridge
// over a live connection. With no host process anywhere in that
// pipeline, nothing was ever actually executing (confirmed two ways:
// every run's raw instrumentation.results said "OK (0 tests)", and a
// direct database check found zero real Plaid Sandbox links ever
// created despite testPlaidLink.test.js reporting "Passed" repeatedly).
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
      // native-compile time when only one will ever actually run. x86_64
      // to match the real, hardware-accelerated (KVM) emulator the GitHub
      // Actions runner boots -- ARM images on an x86_64 host would run
      // under slow QEMU binary translation instead of real acceleration.
      build: "cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures=x86_64",
    },
  },
  devices: {
    emulator: {
      type: "android.emulator",
      device: {
        // Must match mobile-detox.yml's `avd-name` input exactly --
        // reactivecircus/android-emulator-runner boots this AVD before
        // `detox test` runs, and Detox's Android driver attaches to the
        // already-running emulator matching this name instead of trying
        // to launch a second one.
        avdName: "Pixel_API_30",
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
