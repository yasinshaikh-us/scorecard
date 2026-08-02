// Vercel serverless function.
// Fully removes a linked bank: revokes the access token at Plaid via
// /item/remove, then deletes the plaid_items row (cascades to
// plaid_accounts, plaid_account_balances, plaid_auth_numbers). Previously
// synced transactions (source = 'plaid') are left in place on purpose —
// disconnecting stops future syncing, it doesn't erase history.

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

    const { error: deleteError } = await db.from("plaid_items").delete().eq("id", item.id);
    if (deleteError) throw deleteError;

    res.status(200).json({ ok: true });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
