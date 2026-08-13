// Test-only Edge Function: seeds a Plaid Sandbox-linked bank account for
// the same designated dummy account test-login signs into
// (synthetic-monitor@scorecard.test), by minting a Plaid Sandbox
// public_token directly via Plaid's own /sandbox/public_token/create
// endpoint and running it through the SAME token-exchange + sync logic
// plaid-exchange/syncItemTransactions use -- not by driving Plaid Link's
// own hosted UI, which this app doesn't own and can't reliably script
// (see mobile/README.md's Stage 2 section). Lets a Detox spec verify the
// app's OWN handling of a linked account (token exchange, DB writes,
// RLS-scoped reads, balance display) actually works end to end, without
// the fragility of scripting a third-party webview.
//
// Isolation from the real, Production-configured Plaid connection is
// STRUCTURAL, not a runtime check: this function uses its own dedicated
// _shared/plaidSandbox.ts client (separate PLAID_SANDBOX_CLIENT_ID /
// PLAID_SANDBOX_SECRET Edge Function secrets, hardcoded to Plaid's
// Sandbox basePath) for every Plaid API call, and never touches
// _shared/plaid.ts's plaidClient() at all. This is deliberate: Plaid's
// Sandbox and Production environments don't interoperate -- a
// Sandbox-minted public_token/access_token can only ever be exchanged
// against Plaid's Sandbox API, never Production -- so calling the real
// plaid-exchange/plaid-disconnect functions (which use the Production
// client backing this project's actual linked bank account) with a
// Sandbox token cannot work. The exchange/cleanup logic below is
// deliberately duplicated from those two functions (adapted to use the
// sandbox client) rather than refactoring them to take an injectable
// client -- those functions are already deployed and load-bearing for a
// real linked bank account, and this test-only path has no business
// changing their behavior.
//
// Gated by a shared secret (TEST_PLAID_LINK_SECRET, an Edge Function
// secret, same pattern as test-login's TEST_LOGIN_SECRET -- independently
// rotatable, and leaking it can only ever link a Sandbox test bank to the
// one hardcoded dummy account below, using Sandbox-only credentials that
// have no access to any real bank data).
//
// Unlike test-login, this needs a real signed-in user (it writes real
// plaid_items/plaid_accounts rows scoped to a real user_id), so
// verify_jwt is left enabled (the platform default, same as
// plaid-exchange/plaid-disconnect) -- call test-login first to get a
// session, then call this with that session's access_token.
//
// Idempotent: disconnects any bank accounts already linked to this test
// account first, so repeated CI runs always start from a clean slate
// instead of hitting the duplicate-account detection below on a relink
// of the same Sandbox test account (Plaid's Sandbox test data --
// account/routing numbers included -- is deterministic per institution,
// so a second run without cleanup would look like the exact same real
// account relinking).

import { CountryCode, Products } from "npm:plaid@45";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidSandboxClient } from "../_shared/plaidSandbox.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { syncItemTransactions } from "../_shared/syncItemTransactions.ts";
import { fingerprintFor, partitionDuplicateAccounts } from "../_shared/plaidExchangeLogic.ts";

// Plaid's standard, always-available Sandbox test institution ("First
// Platypus Bank") -- sandboxPublicTokenCreate mints a token as if a user
// had already entered its fixed test credentials (user_good/pass_good),
// no UI or credential simulation needed.
const SANDBOX_INSTITUTION_ID = "ins_109508";

// Mirrors plaid-disconnect/index.ts's logic exactly (revoke at Plaid,
// snapshot accounts for the 90-day purge job, delete the plaid_items row),
// against the sandbox client instead of the shared production one.
async function disconnectItem(client: ReturnType<typeof plaidSandboxClient>, db: ReturnType<typeof supabaseAdmin>, item: { id: string; access_token: string; user_id: string }) {
  try {
    await client.itemRemove({ access_token: item.access_token });
  } catch (plaidErr) {
    console.error("Plaid itemRemove failed, continuing with local cleanup", plaidErr);
  }

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
}

async function fetchAuthNumbers(client: ReturnType<typeof plaidSandboxClient>, accessToken: string, itemId: string) {
  try {
    const authResp = await client.authGet({ access_token: accessToken });
    const byAccountId: Record<string, any> = {};
    for (const n of authResp.data.numbers.ach || []) {
      byAccountId[n.account_id] = { account_number: n.account, routing_number: n.routing, wire_routing_number: n.wire_routing || null };
    }
    return byAccountId;
  } catch (authErr) {
    console.error("Plaid auth/get failed for item", itemId, authErr);
    return {};
  }
}

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

  try {
    const user = await requireUser(req);
    const client = plaidSandboxClient();
    const db = supabaseAdmin();

    // Start from a clean slate -- see header comment on why a stale
    // linked account from a prior run would break the duplicate-account
    // detection below.
    const { data: existingItems, error: existingItemsError } = await db
      .from("plaid_items")
      .select("id, access_token, user_id")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (existingItemsError) throw existingItemsError;

    for (const item of existingItems || []) {
      await disconnectItem(client, db, item);
    }

    const sandboxToken = await client.sandboxPublicTokenCreate({
      institution_id: SANDBOX_INSTITUTION_ID,
      initial_products: [Products.Transactions, Products.Auth],
    });
    const publicToken = sandboxToken.data.public_token;

    // From here down mirrors plaid-exchange/index.ts's logic exactly,
    // against the sandbox client instead of the shared production one.
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const itemInfo = await client.itemGet({ access_token: accessToken });
    const institutionId = itemInfo.data.item.institution_id || null;

    let institutionName = null;
    if (institutionId) {
      try {
        const institution = await client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = institution.data.institution.name;
      } catch (nameErr) {
        console.error("Plaid institutionsGetById failed for item", itemId, nameErr);
      }
    }

    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsResp.data.accounts;

    const newAuthByAccountId = await fetchAuthNumbers(client, accessToken, itemId);

    const { data: existingAccounts, error: existingError } = await db
      .from("plaid_accounts")
      .select("account_id, mask, type, subtype, plaid_items!inner(institution_id, status)")
      .eq("user_id", user.id)
      .eq("plaid_items.status", "active");
    if (existingError) throw existingError;

    const existingAccountIds = (existingAccounts || []).map((a: any) => a.account_id);
    let existingAuthByAccountId: Record<string, any> = {};
    if (existingAccountIds.length > 0) {
      const { data: existingAuth, error: existingAuthError } = await db
        .from("plaid_auth_numbers")
        .select("account_id, account_number, routing_number")
        .in("account_id", existingAccountIds);
      if (existingAuthError) throw existingAuthError;
      for (const a of existingAuth || []) existingAuthByAccountId[a.account_id] = a;
    }

    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts,
      institutionId,
      newAuthByAccountId,
      existingAccounts: existingAccounts || [],
      existingAuthByAccountId,
    });
    const duplicateCount = duplicateAccounts.length;

    const resyncAfterDateByAccountId: Record<string, string> = {};
    for (const account of newAccounts) {
      const auth = newAuthByAccountId[account.account_id];
      if (!auth) continue;
      const fingerprint = fingerprintFor(auth.account_number, auth.routing_number);

      const { data: priorFingerprints, error: fingerprintLookupError } = await db
        .from("plaid_account_fingerprints")
        .select("account_id")
        .eq("user_id", user.id)
        .eq("fingerprint", fingerprint);
      if (fingerprintLookupError) throw fingerprintLookupError;

      const priorAccountIds = (priorFingerprints || []).map((f: any) => f.account_id);
      if (priorAccountIds.length === 0) continue;

      const { data: priorTx, error: priorTxError } = await db
        .from("transactions")
        .select("date")
        .eq("source", "plaid")
        .in("plaid_account_id", priorAccountIds)
        .order("date", { ascending: false })
        .limit(1);
      if (priorTxError) throw priorTxError;

      if (priorTx && priorTx.length > 0) {
        resyncAfterDateByAccountId[account.account_id] = priorTx[0].date;
      }
    }

    if (newAccounts.length === 0) {
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (removeErr) {
        console.error("Failed to revoke duplicate item", itemId, removeErr);
      }
      return new Response(
        JSON.stringify({
          error: `${institutionName || "This account"} is already connected. Disconnect it first if you need to relink it.`,
        }),
        { status: 409, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    let plaidItem: any;
    try {
      const { data, error: itemInsertError } = await db
        .from("plaid_items")
        .insert({
          user_id: user.id,
          item_id: itemId,
          access_token: accessToken,
          institution_id: institutionId,
          institution_name: institutionName,
        })
        .select()
        .single();
      if (itemInsertError) throw itemInsertError;
      plaidItem = data;

      const { error: accountsInsertError } = await db.from("plaid_accounts").insert(
        newAccounts.map((a: any) => ({
          item_id: plaidItem.id,
          user_id: user.id,
          account_id: a.account_id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          resync_after_date: resyncAfterDateByAccountId[a.account_id] || null,
        }))
      );
      if (accountsInsertError) throw accountsInsertError;

      const authRows = newAccounts
        .filter((a: any) => newAuthByAccountId[a.account_id])
        .map((a: any) => ({
          account_id: a.account_id,
          user_id: user.id,
          account_number: newAuthByAccountId[a.account_id].account_number,
          routing_number: newAuthByAccountId[a.account_id].routing_number,
          wire_routing_number: newAuthByAccountId[a.account_id].wire_routing_number,
        }));
      if (authRows.length > 0) {
        const { error: authInsertError } = await db.from("plaid_auth_numbers").insert(authRows);
        if (authInsertError) throw authInsertError;
      }

      const fingerprintRows = newAccounts
        .filter((a: any) => newAuthByAccountId[a.account_id])
        .map((a: any) => ({
          user_id: user.id,
          fingerprint: fingerprintFor(newAuthByAccountId[a.account_id].account_number, newAuthByAccountId[a.account_id].routing_number),
          account_id: a.account_id,
          institution_id: institutionId,
        }));
      if (fingerprintRows.length > 0) {
        const { error: fingerprintInsertError } = await db.from("plaid_account_fingerprints").insert(fingerprintRows);
        if (fingerprintInsertError) throw fingerprintInsertError;
      }
    } catch (writeErr) {
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (removeErr) {
        console.error("Failed to revoke item after partial write failure", itemId, removeErr);
      }
      if (plaidItem) {
        await db.from("plaid_items").delete().eq("id", plaidItem.id);
      }
      throw writeErr;
    }

    // Populates transactions + balances synchronously, instead of
    // waiting on Plaid's real (async, non-deterministic-timing) webhook
    // -- see _shared/syncItemTransactions.ts. Passing the sandbox client
    // explicitly is what keeps this sync scoped to Sandbox, same as every
    // other Plaid call in this function.
    const syncResult = await syncItemTransactions(itemId, client, supabaseAdmin());

    return new Response(
      JSON.stringify({
        item_id: itemId,
        institution_name: institutionName,
        accounts: newAccounts.map((a: any) => ({ name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
        skipped_duplicate_accounts: duplicateCount,
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
