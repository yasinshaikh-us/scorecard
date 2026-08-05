// Vercel serverless function.
// Fully removes a linked bank: revokes the access token at Plaid via
// /item/remove, then deletes the plaid_items row (cascades to
// plaid_accounts, plaid_account_balances, plaid_auth_numbers). Previously
// synced transactions (source = 'plaid') are left in place immediately —
// disconnecting stops future syncing, it doesn't erase history on the
// spot — but each account is recorded in plaid_disconnected_accounts
// first, so a scheduled job can purge that history once the account has
// stayed disconnected (never relinked) for more than 90 days. See
// supabase/migrations/20260805010000_purge_stale_disconnected_transactions.sql.

import { plaidClient, requireUser } from "./_plaid.js";
import { supabaseAdmin } from "./_supabaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const itemRowId = req.body?.id;
  if (!itemRowId) {
    res.status(400).json({ error: "id is required" });
    return;
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
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (item.user_id !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
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
      const accountIds = accounts.map((a) => a.account_id);
      const { data: fingerprints, error: fingerprintFetchError } = await db
        .from("plaid_account_fingerprints")
        .select("account_id, fingerprint")
        .in("account_id", accountIds);
      if (fingerprintFetchError) throw fingerprintFetchError;
      const fingerprintByAccountId = {};
      for (const f of fingerprints || []) fingerprintByAccountId[f.account_id] = f.fingerprint;

      const { error: trackError } = await db.from("plaid_disconnected_accounts").insert(
        accountIds.map((accountId) => ({
          user_id: item.user_id,
          account_id: accountId,
          fingerprint: fingerprintByAccountId[accountId] || null,
        }))
      );
      if (trackError) throw trackError;
    }

    const { error: deleteError } = await db.from("plaid_items").delete().eq("id", item.id);
    if (deleteError) throw deleteError;

    res.status(200).json({ ok: true });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
