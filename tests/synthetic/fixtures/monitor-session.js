// Signs in as the dedicated synthetic-monitoring Supabase user (created
// once, out-of-band, via the Admin API) and provides helpers for
// injecting that session into a browser page and for seeding/cleaning up
// fixture transactions directly against Supabase.
//
// Fixture seeding/cleanup (insertTransactions/deleteAllTransactions) uses
// the service-role key, not the monitoring user's own session -- as of
// supabase/migrations/20260805030000_narrow_transactions_rls.sql,
// `authenticated` only has SELECT/UPDATE policies on `transactions` (by
// design: no insert/delete-transaction feature exists in the app, and
// leaving those grants was pure unused risk). A plain authenticated
// INSERT now fails outright ("violates row-level security policy"), and
// a DELETE silently matches zero rows instead of erroring, since RLS
// filters out everything for a command with no policy -- either way,
// fixture management has to go around RLS entirely rather than through
// it. The monitoring user's own session (signIn/injectSession) is still
// what drives the actual app-under-test interactions -- only fixture
// setup/teardown is service-role.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run authenticated synthetic tests`);
  return value;
}

export async function signIn() {
  const url = requireEnv("MONITOR_SUPABASE_URL");
  const anonKey = requireEnv("MONITOR_SUPABASE_ANON_KEY");
  const email = requireEnv("MONITOR_USER_EMAIL");
  const password = requireEnv("MONITOR_USER_PASSWORD");

  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    throw new Error(`Monitoring account sign-in failed: ${resp.status} ${await resp.text()}`);
  }
  const session = await resp.json();
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    userId: session.user.id,
  };
}

// Seeds the browser's localStorage with a real supabase-js session before
// any page script runs, under the same storage key supabase-js itself
// uses (`sb-<project-ref>-auth-token`) — mirrors tests/e2e/dashboard.spec.js's
// fake-session technique, but with a real, valid session from signIn().
export async function injectSession(page, session) {
  const projectRef = new URL(requireEnv("MONITOR_SUPABASE_URL")).hostname.split(".")[0];
  await page.addInitScript(
    ({ projectRef, session }) => {
      const stored = {
        access_token: session.accessToken,
        token_type: "bearer",
        expires_in: session.expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + session.expiresIn,
        refresh_token: session.refreshToken,
        user: { id: session.userId },
      };
      localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(stored));
    },
    { projectRef, session }
  );
}

// Supabase's convention for authenticating as service_role over PostgREST:
// the service-role key goes on both apikey and Authorization -- this
// bypasses RLS entirely (same mechanism api/plaid-exchange.js /
// supabase/functions/_shared/supabaseAdmin.ts use server-side), which is
// exactly what's needed here since regular authenticated writes to
// `transactions` are deliberately not possible anymore (see the top-of-
// file comment). Still scoped to the monitoring user's own rows by the
// explicit user_id filter/value in each call below -- bypassing RLS means
// that scoping is no longer enforced by Postgres, so it matters that
// every call here passes session.userId explicitly.
function serviceRoleHeaders() {
  const serviceRoleKey = requireEnv("MONITOR_SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

// Inserts fixture rows for the monitoring user via service-role (see
// serviceRoleHeaders above for why this can't go through their own
// session anymore).
export async function insertTransactions(session, rows) {
  const url = requireEnv("MONITOR_SUPABASE_URL");
  const resp = await fetch(`${url}/rest/v1/transactions`, {
    method: "POST",
    headers: { ...serviceRoleHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(rows.map((r) => ({ ...r, user_id: session.userId }))),
  });
  if (!resp.ok) throw new Error(`Fixture insert failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// Deletes every transaction owned by the monitoring user — used before
// and after each test so a crashed prior run can't leave stale fixture
// rows behind to confuse the next one. Service-role for the same reason
// as insertTransactions -- a plain authenticated DELETE here would
// silently match zero rows (RLS filters everything out for a command
// with no policy) rather than actually cleaning up.
export async function deleteAllTransactions(session) {
  const url = requireEnv("MONITOR_SUPABASE_URL");
  const resp = await fetch(`${url}/rest/v1/transactions?user_id=eq.${session.userId}`, {
    method: "DELETE",
    headers: serviceRoleHeaders(),
  });
  if (!resp.ok) throw new Error(`Fixture cleanup failed: ${resp.status} ${await resp.text()}`);
}
