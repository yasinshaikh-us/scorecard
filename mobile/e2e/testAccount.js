// Backend-state helpers for the Detox specs, run in the HOST Node process
// (Detox's own Jest runner), not on the device -- so plain fetch against
// Supabase, not the app's client.
//
// WHY THIS EXISTS
//
// Stage 2 runs against one real, shared Supabase account
// (synthetic-monitor@scorecard.test). appFlows.test.js used to open with
// the comment "Assumes the shared test account has no OTHER
// category_rules of its own at the start of a run". That assumption is
// violated by the suite's OWN failure mode: a spec that dies before its
// cleanup step leaves its rule behind, and because the specs then matched
// rows positionally (`.atIndex(0)`), the NEXT run deleted the leftover
// instead of the row it had just created, failed on "No rules yet.", and
// left another row behind. One flake became a permanently red suite that
// only a human clearing the table by hand could fix -- which is exactly
// what happened on runs 57/57-attempt-2 of mobile-detox.yml.
//
// The fix is to stop assuming and start asserting: reset to a known state
// at the start of a run (globalSetup.js), and clean up after every test
// that writes (appFlows.test.js's afterEach), so a failure can no longer
// poison anything downstream.
//
// Scoped by naming convention, deliberately: everything the suite creates
// is prefixed E2E_RULE_PREFIX, and every delete below filters on that
// prefix. A bug here can therefore only ever destroy the suite's own
// rows -- never the real user's category_rules, which live in the same
// table under a different user_id and would otherwise be one missing
// filter away from deletion.

const E2E_RULE_PREFIX = "e2e-";

// Namespaces this run's rows so two runs (a PR smoke run and the nightly
// full run, say) can never collide on the same match_value, and so a
// per-test cleanup can target only what THIS run made. GITHUB_RUN_ATTEMPT
// is included because a re-run keeps the same GITHUB_RUN_ID.
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`
  : `local-${process.pid}`;

function runScopedRuleValue(suffix) {
  return `${E2E_RULE_PREFIX}${RUN_ID}-${suffix}`;
}

function requiredEnv() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const loginSecret = process.env.EXPO_PUBLIC_TEST_LOGIN_SECRET;
  if (!supabaseUrl || !anonKey || !loginSecret) {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / EXPO_PUBLIC_TEST_LOGIN_SECRET " +
        "must all be set to reset the shared test account (see mobile-detox.yml's env block)."
    );
  }
  return { supabaseUrl, anonKey, loginSecret };
}

// Deliberately NOT EXPO_PUBLIC_. Everything under that prefix is inlined
// into the app bundle at build time and is extractable from any installed
// build; this secret is now only ever read here, in Detox's host Node
// process, so it has no business being bundled. (The GitHub repository
// secret keeps its old name -- see mobile-detox.yml's env block, which
// maps it onto this one.)
function plaidLinkSecret() {
  const secret = process.env.TEST_PLAID_LINK_SECRET;
  if (!secret) {
    throw new Error("TEST_PLAID_LINK_SECRET must be set to seed or clean up the Sandbox bank.");
  }
  return secret;
}

// test-login mints a session for the one hardcoded dummy account. The
// same call globalTeardown.js already makes for the Sandbox cleanup.
async function signInTestAccount() {
  const { supabaseUrl, anonKey, loginSecret } = requiredEnv();
  const resp = await fetch(`${supabaseUrl}/functions/v1/test-login`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ secret: loginSecret }),
  });
  if (!resp.ok) {
    throw new Error(`test-login returned ${resp.status}: ${await resp.text()}`);
  }
  const { access_token: accessToken } = await resp.json();
  if (!accessToken) throw new Error("test-login response contained no access_token");
  return accessToken;
}

// Deletes category_rules whose match_value starts with `prefix`, via
// PostgREST. No service-role key needed and none wanted: the account's own
// JWT plus the table's RLS policy ("Users manage their own category rules",
// `for all using auth.uid() = user_id`) already scopes every delete to this
// user's rows, so the blast radius is bounded by the database rather than
// by this code getting the filter right.
//
// The `match_value=like.<prefix>*` filter is also what makes PostgREST
// accept the request at all -- it rejects an unfiltered DELETE outright.
async function deleteRulesWithPrefix(prefix, accessToken) {
  const { supabaseUrl, anonKey } = requiredEnv();
  const token = accessToken || (await signInTestAccount());

  const resp = await fetch(
    `${supabaseUrl}/rest/v1/category_rules?match_value=like.${encodeURIComponent(`${prefix}*`)}`,
    {
      method: "DELETE",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        // Without this PostgREST returns 204 and no body, so there is no
        // way to report how many rows the reset actually removed -- and a
        // silent cleanup is the failure mode this whole file exists to fix.
        prefer: "return=representation",
      },
    }
  );
  if (!resp.ok) {
    throw new Error(`category_rules delete returned ${resp.status}: ${await resp.text()}`);
  }
  const deleted = await resp.json();
  return Array.isArray(deleted) ? deleted.length : 0;
}

// Every rule the suite has ever created, from any run. Used once per run,
// before the device is even booted.
async function resetAllE2eRules(accessToken) {
  return deleteRulesWithPrefix(E2E_RULE_PREFIX, accessToken);
}

// Only this run's rows. Used by afterEach, so a concurrently running
// Stage 2 job's rules are never touched.
async function cleanupThisRunsRules(accessToken) {
  return deleteRulesWithPrefix(`${E2E_RULE_PREFIX}${RUN_ID}-`, accessToken);
}

// Links / unlinks the Plaid Sandbox bank the specs need, by calling the
// test-plaid-link Edge Function directly.
//
// WHY FROM HERE AND NOT FROM THE APP
//
// The app used to carry a "Link test bank" button that made this exact
// call, and the specs tapped it. That put a control which seeds Sandbox
// data -- and, at the time, disconnected every existing bank first -- into
// every build with test login enabled, including the preview build people
// install on a real phone. It fired on one tap, with no confirmation, next
// to the real balances. That is a bad trade for a test affordance, and the
// test never needed it: token exchange and the DB writes all happen inside
// the Edge Function, so tapping a button proved nothing about the app that
// seeding from here doesn't. What the specs actually assert -- that the app
// fetches a linked account and renders it -- survives intact, and is if
// anything a truer test now, because the app renders state it did not
// create, exactly as a real user's app does after a real Plaid Link.
//
// The Edge Function refuses any caller that isn't the dummy account, so
// this can only ever act on synthetic-monitor@scorecard.test.
async function callTestPlaidLink(body, accessToken) {
  const { supabaseUrl, anonKey } = requiredEnv();
  const token = accessToken || (await signInTestAccount());

  const resp = await fetch(`${supabaseUrl}/functions/v1/test-plaid-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ secret: plaidLinkSecret(), ...body }),
  });
  if (!resp.ok) {
    throw new Error(`test-plaid-link returned ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// Seeds the Sandbox bank. Idempotent -- the function removes the Sandbox
// item it previously seeded before creating a new one, so a spec can call
// this without knowing what the last run left behind.
async function seedSandboxBank(accessToken) {
  return callTestPlaidLink({}, accessToken);
}

// Removes it again. Called by globalTeardown.js at the end of a run; see
// that file for why a leftover Sandbox item is more than untidy.
async function cleanupSandboxBank(accessToken) {
  const { disconnected } = await callTestPlaidLink({ action: "cleanup" }, accessToken);
  return disconnected;
}

// Seeds / clears the Stage 2 ledger via the test-seed-ledger Edge
// Function.
//
// Not a direct PostgREST write, which is what this first tried: the
// transactions table gives a signed-in user SELECT and UPDATE and
// nothing else, so an insert comes back 42501. That is the correct
// default -- ledger rows should come from a bank, not from whoever holds
// an anon key -- so the seeding runs with the service role inside the
// function instead, which is also exactly how test-plaid-link seeds this
// same account's Sandbox bank.
async function callTestSeedLedger(body, accessToken) {
  const { supabaseUrl, anonKey } = requiredEnv();
  const token = accessToken || (await signInTestAccount());

  const resp = await fetch(`${supabaseUrl}/functions/v1/test-seed-ledger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`test-seed-ledger returned ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// Clears any leftover rows and writes a fresh ledger. Idempotent: the
// function clears before it seeds, whichever action it is given.
async function seedE2eLedger(accessToken) {
  return callTestSeedLedger({}, accessToken);
}

async function clearE2eLedger(accessToken) {
  const { cleared } = await callTestSeedLedger({ action: "clear" }, accessToken);
  return cleared;
}

module.exports = {
  E2E_RULE_PREFIX,
  seedE2eLedger,
  clearE2eLedger,
  RUN_ID,
  runScopedRuleValue,
  signInTestAccount,
  resetAllE2eRules,
  cleanupThisRunsRules,
  seedSandboxBank,
  cleanupSandboxBank,
};
