// Calls the check_and_increment_query_rate_limit() RPC (see
// supabase/migrations/20260818000000_add_query_rate_limit.sql) with the
// caller's own access token, same RLS-respecting pattern as every other
// request in transactionsData.ts. Used by the `query` Edge Function to
// cap how often a signed-in user can trigger a billed Anthropic call.
export async function checkQueryRateLimit(url: string, anonKey: string, accessToken: string) {
  const resp = await fetch(`${url}/rest/v1/rpc/check_and_increment_query_rate_limit`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const rows = await resp.json();

  if (!resp.ok) {
    const err: any = new Error("Supabase request failed");
    err.status = resp.status;
    err.body = rows;
    throw err;
  }

  // RETURNS TABLE with no set-returning input always produces exactly
  // one row, same PostgREST array-wrapping as ledger_meta().
  const row = rows[0] || {};
  return {
    allowed: !!row.allowed,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}
