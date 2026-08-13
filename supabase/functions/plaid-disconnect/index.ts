// Edge Function. Called by the Expo app in mobile/ (see mobile/lib/).
// Fully removes a linked bank: revokes the access token at Plaid via
// /item/remove, then deletes the plaid_items row (cascades to
// plaid_accounts, plaid_account_balances, plaid_auth_numbers). Previously
// synced transactions (source = 'plaid') are left in place immediately —
// disconnecting stops future syncing, it doesn't erase history on the
// spot — but each account is recorded in plaid_disconnected_accounts
// first, so a scheduled job can purge that history once the account has
// stayed disconnected (never relinked) for more than 90 days. See
// supabase/migrations/20260805010000_purge_stale_disconnected_transactions.sql.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const itemRowId = body?.id;
  if (!itemRowId) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();
    const db = supabaseAdmin();

    const { data: item, error: fetchError } = await db
      .from("plaid_items")
      .select("id, access_token, user_id")
      .eq("id", itemRowId)
      .single();

    if (fetchError || !item) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    if (item.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    try {
      await client.itemRemove({ access_token: item.access_token });
    } catch (plaidErr) {
      // The Item may already be invalid at Plaid's end (e.g. the user
      // revoked access from their bank's own settings first) — don't let
      // that block cleaning up our own copy of the token.
      console.error("Plaid itemRemove failed, continuing with local cleanup", plaidErr);
    }

    // Snapshot which accounts are being disconnected, and when, before the
    // plaid_items delete below cascades plaid_accounts away — that cascade
    // is the only place this information would otherwise be lost, and the
    // 90-day purge job needs it to know how long an account has been gone.
    const { data: accounts, error: accountsFetchError } = await db
      .from("plaid_accounts")
      .select("account_id")
      .eq("item_id", item.id);
    if (accountsFetchError) throw accountsFetchError;

    if (accounts && accounts.length > 0) {
      const accountIds = accounts.map((a: any) => a.account_id);
      const { data: fingerprints, error: fingerprintFetchError } = await db
        .from("plaid_account_fingerprints")
        .select("account_id, fingerprint")
        .in("account_id", accountIds);
      if (fingerprintFetchError) throw fingerprintFetchError;
      const fingerprintByAccountId: Record<string, string> = {};
      for (const f of fingerprints || []) fingerprintByAccountId[f.account_id] = f.fingerprint;

      const { error: trackError } = await db.from("plaid_disconnected_accounts").insert(
        accountIds.map((accountId: string) => ({
          user_id: item.user_id,
          account_id: accountId,
          fingerprint: fingerprintByAccountId[accountId] || null,
        }))
      );
      if (trackError) throw trackError;
    }

    const { error: deleteError } = await db.from("plaid_items").delete().eq("id", item.id);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || err.response?.status || 500;
    return new Response(JSON.stringify({ error: err.response?.data || String(err.message || err) }), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
