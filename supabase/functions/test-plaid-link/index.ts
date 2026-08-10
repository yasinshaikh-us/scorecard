// Test-only Edge Function: seeds a Plaid Sandbox-linked bank account for
// the same designated dummy account test-login signs into
// (synthetic-monitor@scorecard.test), by minting a Plaid Sandbox
// public_token directly via Plaid's own /sandbox/public_token/create
// endpoint and running it through the REAL production plaid-exchange +
// syncItemTransactions pipeline -- not by driving Plaid Link's own hosted
// UI, which this app doesn't own and can't reliably script (see
// mobile/README.md's Stage 2 section). Lets a Detox spec verify the
// app's OWN handling of a linked account (token exchange, DB writes,
// RLS-scoped reads, balance display) actually works end to end, without
// the fragility of scripting a third-party webview.
//
// Gated by a shared secret (TEST_PLAID_LINK_SECRET, an Edge Function
// secret, same pattern as test-login's TEST_LOGIN_SECRET -- independently
// rotatable, and leaking it can only ever link a Sandbox test bank to the
// one hardcoded dummy account below) AND requires PLAID_ENV to actually
// be "sandbox" -- this can never touch a real bank or a real Plaid
// environment, even if the secret leaked.
//
// Unlike test-login, this needs a real signed-in user (it writes real
// plaid_items/plaid_accounts rows scoped to a real user_id), so
// verify_jwt is left enabled (the platform default, same as
// plaid-exchange/plaid-disconnect) -- call test-login first to get a
// session, then call this with that session's access_token.
//
// Idempotent: disconnects any bank accounts already linked to this test
// account first (via the real plaid-disconnect function, so Items are
// properly revoked at Plaid too, not just deleted locally), so repeated
// CI runs always start from a clean slate instead of hitting
// plaid-exchange's duplicate-account detection on a relink of the same
// Sandbox test account (Plaid's Sandbox test data -- account/routing
// numbers included -- is deterministic per institution, so a second run
// without cleanup would look like the exact same real account relinking).

import { Products } from "npm:plaid@45";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { syncItemTransactions } from "../_shared/syncItemTransactions.ts";

// Plaid's standard, always-available Sandbox test institution ("First
// Platypus Bank") -- sandboxPublicTokenCreate mints a token as if a user
// had already entered its fixed test credentials (user_good/pass_good),
// no UI or credential simulation needed.
const SANDBOX_INSTITUTION_ID = "ins_109508";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const configuredSecret = Deno.env.get("TEST_PLAID_LINK_SECRET");
  if (!configuredSecret) {
    return new Response(JSON.stringify({ error: "TEST_PLAID_LINK_SECRET is not configured on this project." }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.secret !== "string" || body.secret !== configuredSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Same default as plaidClient() -- an unset PLAID_ENV means sandbox
  // already, only an explicit non-sandbox value should block this.
  const plaidEnv = Deno.env.get("PLAID_ENV") || "sandbox";
  if (plaidEnv !== "sandbox") {
    return new Response(JSON.stringify({ error: `Refusing to run: PLAID_ENV is "${plaidEnv}", not "sandbox".` }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();
    const db = supabaseAdmin();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not available in this Edge Function's environment.");

    // Start from a clean slate -- see header comment on why a stale
    // linked account from a prior run would break plaid-exchange's
    // duplicate-account detection.
    const { data: existingItems, error: existingItemsError } = await db
      .from("plaid_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (existingItemsError) throw existingItemsError;

    for (const item of existingItems || []) {
      const disconnectResp = await fetch(`${supabaseUrl}/functions/v1/plaid-disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.accessToken}`,
        },
        body: JSON.stringify({ id: item.id }),
      });
      if (!disconnectResp.ok) {
        const disconnectData = await disconnectResp.json().catch(() => ({}));
        throw new Error(`Cleanup failed disconnecting existing item ${item.id}: ${disconnectData.error || disconnectResp.status}`);
      }
    }

    const sandboxToken = await client.sandboxPublicTokenCreate({
      institution_id: SANDBOX_INSTITUTION_ID,
      initial_products: [Products.Transactions, Products.Auth],
    });
    const publicToken = sandboxToken.data.public_token;

    const exchangeResp = await fetch(`${supabaseUrl}/functions/v1/plaid-exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({ public_token: publicToken }),
    });
    const exchangeData = await exchangeResp.json().catch(() => ({}));
    if (!exchangeResp.ok) {
      throw new Error(`plaid-exchange failed: ${exchangeData.error || exchangeResp.status}`);
    }

    // plaid-exchange's response doesn't include Plaid's item_id -- the
    // cleanup above guarantees this user has exactly one active item at
    // this point (the one just created), so it's safe to look it up by
    // most-recently-created instead of threading it through the response.
    const { data: newItem, error: newItemError } = await db
      .from("plaid_items")
      .select("item_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (newItemError) throw newItemError;

    // Populates transactions + balances synchronously, instead of
    // waiting on Plaid's real (async, non-deterministic-timing) webhook
    // -- see _shared/syncItemTransactions.ts.
    const syncResult = await syncItemTransactions(newItem.item_id);

    return new Response(
      JSON.stringify({
        item_id: newItem.item_id,
        institution_name: exchangeData.institution_name,
        accounts: exchangeData.accounts,
        sync: syncResult,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || err.response?.status || 500;
    return new Response(JSON.stringify({ error: err.response?.data || String(err.message || err) }), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
