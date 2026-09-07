// Keeps this project's Supabase database out of Supabase's free-tier
// 7-day-inactivity auto-pause, independent of anything else in this repo
// actually running. mobile-detox.yml's nightly schedule already exercises
// this project, but it's a slow, occasionally-flaky real-emulator suite
// with no separate check that it actually completed -- this is a small,
// independent second source of activity. See
// .github/workflows/supabase-keepalive.yml for the schedule and reasoning.
//
// Reuses the same shared test-login mechanism (supabase/functions/test-login,
// gated by TEST_LOGIN_SECRET) mobile-detox.yml already uses to sign in as
// the dedicated synthetic-monitor@scorecard.test account -- no service-role
// key and no new secrets, matching this repo's existing policy of never
// putting a service-role key in CI.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

async function main() {
  const url = requireEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  const secret = requireEnv("TEST_LOGIN_SECRET");

  const signInResp = await fetch(`${url}/functions/v1/test-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  const signInBody = await signInResp.json();
  if (!signInResp.ok) {
    throw new Error(signInBody?.error || `Test login failed: ${signInResp.status}`);
  }

  // A real, authenticated PostgREST query -- exactly the kind of activity
  // Supabase's inactivity check looks for, not just a health-check ping
  // against some surface that never touches the database itself.
  const queryResp = await fetch(`${url}/rest/v1/transactions?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${signInBody.access_token}` },
  });
  if (!queryResp.ok) {
    throw new Error(`Keep-alive query failed: ${queryResp.status} ${await queryResp.text()}`);
  }

  console.log("Supabase keep-alive: signed in and queried transactions successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
