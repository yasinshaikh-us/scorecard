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
const {
  resetAllE2eRules,
  seedSandboxBank,
  seedE2eLedger,
  clearE2eLedger,
  E2E_RULE_PREFIX,
  RUN_ID,
} = require("./testAccount");

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

// Seeds the Plaid Sandbox bank the specs need, BEFORE detoxSetup boots the
// emulator -- and that ordering is the whole point, not a tidiness
// preference.
//
// The seed first lived in appFlows/testPlaidLink's own `beforeAll`, which
// put ~12s of host-side network I/O between the emulator finishing a cold
// boot and the app ever reaching the foreground. The device spends that
// window sitting on the launcher while the system is still settling, and
// on a CI runner the launcher loses that race: a real run came back with
// every one of the 14 specs failing on Espresso's "Waited for the root of
// the view hierarchy to have window focus", and the failure artifact
// showed why -- a "Pixel Launcher isn't responding" ANR dialog parked on
// top, holding focus for the rest of the run. It survived the retry, since
// the dialog outlives the specs that provoked it.
//
// Running here costs the same seconds against no device at all. It also
// means every spec starts signed-out-but-linked, so nothing depends on
// which spec happened to seed first.
async function seedBank() {
  let lastErr;
  for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt++) {
    try {
      const result = await seedSandboxBank();
      console.log(
        `[e2e-seed] run ${RUN_ID}: linked ${result?.accounts?.length ?? 0} Sandbox account(s) ` +
          `from ${result?.institution_name || "the Sandbox institution"}`
      );
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[e2e-seed] attempt ${attempt}/${RESET_ATTEMPTS} failed: ${err}`);
    }
  }
  // Fatal for the same reason the rules reset is: every spec below assumes
  // a linked bank, so continuing would just spend 14 minutes turning one
  // clear backend failure into a screenful of confusing UI ones.
  throw new Error(
    `[e2e-seed] could not seed the Sandbox bank after ${RESET_ATTEMPTS} attempts -- ` +
      `refusing to run Stage 2 without one. Last error: ${lastErr}`
  );
}

// The ledger the Ask specs ask their questions against. Cleared first for
// the same reason the rules are: a cancelled job or a crashed emulator
// skips teardown, and a run that seeded twice would report doubled
// totals -- which is worse than no data, because it looks like data.
//
// Fatal on failure, like the other two: the Ask specs assert against what
// this writes, so continuing without it would turn one clear backend
// error into a screenful of confusing UI ones.
async function seedLedger() {
  let lastErr;
  for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt++) {
    try {
      const removed = await clearE2eLedger();
      const seeded = await seedE2eLedger();
      console.log(`[e2e-ledger] run ${RUN_ID}: cleared ${removed} leftover row(s), seeded ${seeded}`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[e2e-ledger] attempt ${attempt}/${RESET_ATTEMPTS} failed: ${err}`);
    }
  }
  throw new Error(
    `[e2e-ledger] could not seed the test ledger after ${RESET_ATTEMPTS} attempts -- ` +
      `refusing to run Stage 2 against an empty one. Last error: ${lastErr}`
  );
}

module.exports = async function globalSetup(globalConfig) {
  await resetTestAccount();
  await seedLedger();
  await seedBank();
  await detoxSetup(globalConfig);
};
