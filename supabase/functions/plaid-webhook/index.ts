// Public HTTP endpoint registered as the webhook URL in the Plaid
// dashboard (Team Settings -> Webhooks) once this function is deployed.
// No caller auth beyond Plaid's own JWT signature (verifyPlaidWebhook) —
// this must stay reachable without a Supabase session, since Plaid is
// the one calling it.

import { verifyPlaidWebhook } from "../_shared/verifyPlaidWebhook.ts";
import { syncItemTransactions } from "../_shared/syncItemTransactions.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { plaidClient } from "../_shared/plaid.ts";

const TRANSACTIONS_SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  try {
    await verifyPlaidWebhook(rawBody, req.headers.get("plaid-verification"));
  } catch (err) {
    console.error("Plaid webhook verification failed", err);
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const { webhook_type, webhook_code, item_id } = payload;

  try {
    if (webhook_type === "TRANSACTIONS" && TRANSACTIONS_SYNC_CODES.has(webhook_code)) {
      const result = await syncItemTransactions(item_id, plaidClient(), supabaseAdmin());
      console.log(`Synced item ${item_id}:`, result);
    } else if (webhook_type === "ITEM") {
      const db = supabaseAdmin();
      if (webhook_code === "ERROR") {
        await db.from("plaid_items").update({ status: "error" }).eq("item_id", item_id);
      } else if (webhook_code === "PENDING_EXPIRATION") {
        await db.from("plaid_items").update({ status: "pending_expiration" }).eq("item_id", item_id);
      } else if (webhook_code === "USER_PERMISSION_REVOKED") {
        await db.from("plaid_items").update({ status: "revoked" }).eq("item_id", item_id);
      }
    }
    // Other webhook types (e.g. HOLDINGS, INVESTMENTS_TRANSACTIONS) aren't
    // relevant to this app's Transactions + Auth + Balance scope and are
    // acknowledged without action.

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Plaid webhook handling failed", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
