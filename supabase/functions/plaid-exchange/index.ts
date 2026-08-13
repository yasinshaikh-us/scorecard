// Edge Function. Called by the Expo app in mobile/ (see mobile/lib/).
// Exchanges a Plaid Link public_token for a permanent access_token, then
// stores the item/accounts/auth-numbers server-side via the service-role
// key. The access_token and account/routing numbers never round-trip
// back to the client — only a non-sensitive summary does.
//
// See ../_shared/plaidExchangeLogic.ts for the duplicate-account
// detection this delegates to (and its tests).

import { CountryCode } from "npm:plaid@45";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { fingerprintFor, partitionDuplicateAccounts } from "../_shared/plaidExchangeLogic.ts";

async function fetchAuthNumbers(client: any, accessToken: string, itemId: string) {
  // Best-effort: not every institution/account supports Auth. Returns a
  // map of account_id -> { account_number, routing_number }.
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

  const body = await req.json().catch(() => ({}));
  const publicToken = body?.public_token;
  if (!publicToken) {
    return new Response(JSON.stringify({ error: "public_token is required" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();
    const db = supabaseAdmin();

    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const itemInfo = await client.itemGet({ access_token: accessToken });
    const institutionId = itemInfo.data.item.institution_id || null;

    // Best-effort: a naming lookup failing shouldn't abort a link that
    // already succeeded at Plaid -- that would leave the Item live and
    // unrevoked with no local record of it at all.
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

    // The user's currently-connected accounts to dedup against. Scoped to
    // active items only, so an account that was properly disconnected can
    // always be relinked.
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

    // For each genuinely new account, check whether its fingerprint
    // matches one this user has linked before (at any point, including
    // accounts since fully disconnected). If so, find the latest date we
    // already have Plaid-sourced transaction history through for it, so
    // the sync path can skip re-inserting that history when Plaid's fresh
    // Item does its full resync. Only possible for accounts with Auth
    // numbers available.
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
      // Every account in this Item is one the user already has connected
      // -- there's nothing new to keep, so revoke it at Plaid rather than
      // leaving an unused duplicate Item connected.
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

      // Record this account's fingerprint so a future relink -- even
      // after a full disconnect -- can recognize it. Only possible for
      // accounts Auth numbers were available for.
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
      // Partial failure -- don't leave a zombie plaid_items row (a live,
      // unlinked access token) behind. Best-effort cleanup, then surface
      // the original error.
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

    return new Response(
      JSON.stringify({
        institution_name: institutionName,
        accounts: newAccounts.map((a: any) => ({ name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
        skipped_duplicate_accounts: duplicateCount,
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
