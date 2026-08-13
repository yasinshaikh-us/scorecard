// Jest globalSetup for the Detox run (Stage 2). Wraps Detox's own setup
// and first resets the shared test account to a known state.
//
// The mirror image of globalTeardown.js, and it exists for the same class
// of reason: Stage 2 runs against one real, shared Supabase account, so
// anything a previous run left behind is this run's problem. Teardown
// alone cannot cover that -- a cancelled job, a crashed emulator, or a
// spec that fails before its own cleanup all skip teardown entirely.
// Resetting at the START is the only step guaranteed to run.
//
// Deliberately FAILS THE RUN if the reset does not succeed, unlike
// globalTeardown's best-effort cleanup. The two are not symmetric: a
// failed teardown leaves debris the next run's reset will clear, whereas a
// failed reset means every assertion afterwards is running against unknown
// state. A fast, explicit "could not reset" is worth far more than a
// 14-minute run that ends in a cascade of confusing UI failures -- which
// is precisely how the leftover-rule bug presented before this existed.
const detoxSetup = require("detox/runners/jest/globalSetup");
const { resetAllE2eRules, E2E_RULE_PREFIX, RUN_ID } = require("./testAccount");

// Two retries: a single transient network blip on a shared CI runner is
// not a reason to throw away a run that takes ~14 minutes, but a genuinely
// unreachable backend should surface immediately rather than as UI flake.
const RESET_ATTEMPTS = 3;

async function resetTestAccount() {
  let lastErr;
  for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt++) {
    try {
      const deleted = await resetAllE2eRules();
      console.log(
        `[e2e-reset] run ${RUN_ID}: removed ${deleted} leftover "${E2E_RULE_PREFIX}*" rule(s) from the shared test account`
      );
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[e2e-reset] attempt ${attempt}/${RESET_ATTEMPTS} failed: ${err}`);
    }
  }
  throw new Error(
    `[e2e-reset] could not reset the shared test account after ${RESET_ATTEMPTS} attempts -- ` +
      `refusing to run Stage 2 against unknown state. Last error: ${lastErr}`
  );
}

module.exports = async function globalSetup(globalConfig) {
  await resetTestAccount();
  await detoxSetup(globalConfig);
};
