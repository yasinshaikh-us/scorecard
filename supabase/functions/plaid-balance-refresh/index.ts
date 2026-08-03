// Scheduled Edge Function (see the pg_cron job added in
// supabase/migrations/20260802000100_schedule_plaid_balance_refresh.sql).
// Plaid's Balance product has no webhook push, so this is the only way
// balances stay current: walk every active plaid_items row and refresh
// its accounts' balances.
//
// Invoked by pg_cron via pg_net with the project's service-role key in
// the Authorization header, not by an end user — there is no per-user
// auth to check here, only the shared secret pg_cron sends.

import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req) => {
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = supabaseAdmin();
  const client = plaidClient();

  const { data: items, error } = await db
    .from("plaid_items")
    .select("id, user_id, access_token, item_id")
    .eq("status", "active");

  if (error) {
    console.error("Failed to list plaid_items", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results = await Promise.allSettled(
    (items || []).map(async (item) => {
      const resp = await client.accountsBalanceGet({ access_token: item.access_token });

      const rows = resp.data.accounts.map((a) => ({
        account_id: a.account_id,
        user_id: item.user_id,
        available: a.balances.available,
        current: a.balances.current,
        iso_currency_code: a.balances.iso_currency_code,
        as_of: new Date().toISOString(),
      }));

      const { error: upsertError } = await db
        .from("plaid_account_balances")
        .upsert(rows, { onConflict: "account_id" });
      if (upsertError) throw upsertError;

      return item.item_id;
    })
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error("Balance refresh failures", failed);
  }

  return new Response(
    JSON.stringify({ refreshed: results.length - failed.length, failed: failed.length }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
