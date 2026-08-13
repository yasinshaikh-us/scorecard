/** @type {import('@jest/types').Config.InitialOptions} */
// Detox's own test runner, deliberately separate from the root
// package.json's "jest" config (Stage 1's unit/component tests) -- this
// one needs Detox's device-connected test environment, not jsdom/node.
module.exports = {
  rootDir: "..",
  testMatch: ["<rootDir>/e2e/**/*.test.js"],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: "detox/runners/jest/globalSetup",
  // Wraps Detox's own teardown to also remove the Plaid Sandbox bank the
  // specs link -- see e2e/globalTeardown.js for why a leftover one breaks
  // the hourly balance-refresh cron in production.
  globalTeardown: "<rootDir>/e2e/globalTeardown.js",
  reporters: ["detox/runners/jest/reporter"],
  testEnvironment: "detox/runners/jest/testEnvironment",
  verbose: true,
};
