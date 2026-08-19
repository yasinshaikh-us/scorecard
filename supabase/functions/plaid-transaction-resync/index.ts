// Scheduled Edge Function (see the pg_cron job added in
// supabase/migrations/20260819190000_add_sync_health_and_resync_cron.sql).
// The transaction path is webhook-driven, so this is the only thing that
// pulls transactions on a timer -- a floor under plaid-webhook rather than
// a replacement for it. See _shared/resyncItems.ts for why it exists.
//
// Invoked by pg_cron via pg_net with the project's service-role key in the
// Authorization header, not by an end user -- there is no per-user auth to
// check here, only the shared secret pg_cron sends. Same posture as
// plaid-balance-refresh, which is why this keeps verify_jwt on: the
// service-role key IS a valid Supabase JWT, so the gateway accepts it and
// the check below confirms it is specifically that key.

import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { resyncItems } from "../_shared/resyncItems.ts";

Deno.serve(async (req) => {
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await resyncItems(supabaseAdmin(), plaidClient());
    console.log("Scheduled transaction resync complete:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Scheduled transaction resync failed", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
