// Edge Function. Called by the Expo app in mobile/ (see
// mobile/components/AccountBalances.tsx) to refresh the signed-in user's
// balances on demand -- when Home mounts, and on pull-to-refresh.
//
// Why this exists alongside the hourly plaid-balance-refresh cron: the
// cron keeps balances from going stale in the background, but it knows
// nothing about when anyone is actually looking. Worst case it leaves the
// figure on screen 59 minutes old, and the app never asked for anything
// fresher -- opening the app triggered no refresh at all, and even
// pull-to-refresh only re-fetched transactions. A balance you are staring
// at should be the balance the bank has right now, which is what a
// commercial banking app does and what this closes.
//
// Two things keep that from becoming an expensive tap-loop. Plaid bills
// per Balance call, and the app can fire this on every mount:
//
//   1. A cooldown. plaid_account_balances.as_of already records when each
//      balance was last written -- by this function, by the cron, or by a
//      transaction webhook -- so the freshest row for this user is an
//      exact answer to "would calling Plaid again tell us anything new?".
//      Inside the window it returns the age instead of calling Plaid, and
//      the client just re-reads what is already stored.
//   2. Per-user scoping. Unlike plaid-balance-refresh, which sweeps every
//      active Item on the project, this only ever touches Items belonging
//      to the caller -- so its cost scales with one person's use of their
//      own app, not with the user table.
//
// Auth is the ordinary client-facing shape (verify_jwt at the gateway,
// requireUser to recover WHICH user), not the cron's shared service-role
// secret. The service-role client below is what reads access_token out of
// plaid_items -- a column no client may ever see -- and every query
// through it is filtered on the caller's own user_id.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { refreshAccountBalances } from "../_shared/refreshAccountBalances.ts";
import { cooldownRemaining } from "../_shared/balanceRefreshCooldown.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);
    const db = supabaseAdmin();

    const { data: freshest, error: freshestError } = await db
      .from("plaid_account_balances")
      .select("as_of")
      .eq("user_id", user.id)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (freshestError) throw freshestError;

    const retryAfterSeconds = cooldownRemaining(freshest?.as_of ?? null, Date.now());
    if (retryAfterSeconds > 0) {
      // 200, not 429. Nothing went wrong and the client needs no
      // recovery path: the stored balance is under a minute old, which
      // is the answer to the question it asked. It re-reads and moves on.
      return new Response(JSON.stringify({ refreshed: 0, failed: 0, skipped: true, retryAfterSeconds }), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { data: items, error: itemsError } = await db
      .from("plaid_items")
      .select("user_id, access_token")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (itemsError) throw itemsError;

    const client = plaidClient();
    const results = await Promise.allSettled(
      (items || []).map((item) => refreshAccountBalances(db, client, item))
    );

    // Partial failure is reported, not thrown: with several banks linked,
    // one institution being down is no reason to withhold the other's
    // fresh balance. The client re-reads either way.
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(`Balance refresh failures for user ${user.id}`, failed);
    }

    return new Response(
      JSON.stringify({ refreshed: results.length - failed.length, failed: failed.length, skipped: false }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || 500;
    return new Response(JSON.stringify({ error: err.body || String(err.message || err) }), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
