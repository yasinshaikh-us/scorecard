// Jest globalTeardown for the Detox run (Stage 2). Wraps Detox's own
// teardown and then removes the Plaid Sandbox bank the specs linked.
//
// WHY THIS EXISTS
//
// supabase/functions/test-plaid-link seeds a real Plaid Sandbox item into
// the real project so a spec can verify the app's own linked-account
// handling. That item used to outlive the run: the function cleans up at
// the START of a run (so duplicate-account detection doesn't trip on a
// relink), which means the LAST run's item stays behind indefinitely.
//
// A leftover Sandbox item is not merely untidy. Its access_token was
// minted by the Sandbox Plaid client, while the hourly
// plaid-balance-refresh cron uses the PRODUCTION client -- the two
// environments don't interoperate, so that item can never refresh and
// fails the cron on every tick, forever. Worse, it fails quietly: the
// cron row reads "succeeded" (pg_net only queues the request), the HTTP
// status is 200, and the failure shows up only as a count inside a JSON
// response body. That is exactly what was happening in production before
// this file existed.
//
// The Edge Function's start-of-run cleanup is deliberately kept as the
// safety net for a run that never reaches teardown (a cancelled job, a
// crashed emulator).
const detoxTeardown = require("detox/runners/jest/globalTeardown");
const { cleanupSandboxBank } = require("./testAccount");

// Deliberately non-fatal. A cleanup failure must not turn an otherwise
// green Stage 2 run red -- the next run's start-of-run cleanup will
// remove whatever is left. It is logged loudly instead, since a silent
// failure here is the exact problem this file was written to fix.
//
// The HTTP call itself lives in testAccount.js, next to the seeding call
// the specs make -- the two are the same endpoint with a different body,
// and keeping one inlined here is how they drifted apart before.
async function removeSandboxBank() {
  const disconnected = await cleanupSandboxBank();
  console.log(`[sandbox-cleanup] disconnected ${disconnected} Sandbox item(s)`);
}

module.exports = async function globalTeardown(globalConfig) {
  try {
    await removeSandboxBank();
  } catch (err) {
    console.error(
      "[sandbox-cleanup] FAILED -- a Plaid Sandbox item may be left in the project, " +
        "which will fail the hourly plaid-balance-refresh cron until the next Detox run cleans it up:",
      err
    );
  } finally {
    // Always runs: Detox's own teardown shuts the device/emulator session
    // down, and skipping it would leave the run hanging.
    await detoxTeardown(globalConfig);
  }
};
