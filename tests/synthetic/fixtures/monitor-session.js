// Signs in as the dedicated synthetic-monitoring Supabase user (created
// once, out-of-band, via the Admin API) and provides helpers for
// injecting that session into a browser page and for seeding/cleaning up
// fixture transactions directly against Supabase — all scoped to that
// user by the `transactions` RLS policy (auth.uid() = user_id, FOR ALL),
// so this can never touch any other user's rows.

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

function restHeaders(session) {
  return {
    apikey: requireEnv("MONITOR_SUPABASE_ANON_KEY"),
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

// Inserts fixture rows as the monitoring user (RLS-scoped to their own
// user_id, so this can never touch anyone else's data).
export async function insertTransactions(session, rows) {
  const url = requireEnv("MONITOR_SUPABASE_URL");
  const resp = await fetch(`${url}/rest/v1/transactions`, {
    method: "POST",
    headers: { ...restHeaders(session), Prefer: "return=representation" },
    body: JSON.stringify(rows.map((r) => ({ ...r, user_id: session.userId }))),
  });
  if (!resp.ok) throw new Error(`Fixture insert failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// Deletes every transaction owned by the monitoring user — used before
// and after each test so a crashed prior run can't leave stale fixture
// rows behind to confuse the next one.
export async function deleteAllTransactions(session) {
  const url = requireEnv("MONITOR_SUPABASE_URL");
  const resp = await fetch(`${url}/rest/v1/transactions?user_id=eq.${session.userId}`, {
    method: "DELETE",
    headers: restHeaders(session),
  });
  if (!resp.ok) throw new Error(`Fixture cleanup failed: ${resp.status} ${await resp.text()}`);
}
