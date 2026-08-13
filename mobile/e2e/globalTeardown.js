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

// Deliberately non-fatal. A cleanup failure must not turn an otherwise
// green Stage 2 run red -- the next run's start-of-run cleanup will
// remove whatever is left. It is logged loudly instead, since a silent
// failure here is the exact problem this file was written to fix.
async function cleanupSandboxBank() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const loginSecret = process.env.EXPO_PUBLIC_TEST_LOGIN_SECRET;
  const plaidLinkSecret = process.env.EXPO_PUBLIC_TEST_PLAID_LINK_SECRET;

  if (!supabaseUrl || !anonKey || !loginSecret || !plaidLinkSecret) {
    console.warn("[sandbox-cleanup] SKIPPED: test-login/test-plaid-link env vars are not all set");
    return;
  }

  // test-plaid-link keeps verify_jwt enabled (it writes rows scoped to a
  // real user_id), so a session is needed before it can be called at all.
  const loginResp = await fetch(`${supabaseUrl}/functions/v1/test-login`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ secret: loginSecret }),
  });
  if (!loginResp.ok) {
    throw new Error(`test-login returned ${loginResp.status}: ${await loginResp.text()}`);
  }
  // test-login returns { access_token, refresh_token } at the top level.
  const { access_token: accessToken } = await loginResp.json();
  if (!accessToken) {
    throw new Error("test-login response contained no access_token");
  }

  const cleanupResp = await fetch(`${supabaseUrl}/functions/v1/test-plaid-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ secret: plaidLinkSecret, action: "cleanup" }),
  });
  if (!cleanupResp.ok) {
    throw new Error(`test-plaid-link cleanup returned ${cleanupResp.status}: ${await cleanupResp.text()}`);
  }

  const { disconnected } = await cleanupResp.json();
  console.log(`[sandbox-cleanup] disconnected ${disconnected} Sandbox item(s)`);
}

module.exports = async function globalTeardown(globalConfig) {
  try {
    await cleanupSandboxBank();
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
