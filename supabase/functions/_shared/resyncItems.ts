// The safety-net poll for the Plaid transaction path.
//
// Transactions have no timed pull of their own: plaid-webhook is the only
// caller of syncItemTransactions, so anything that stops webhooks landing
// freezes the ledger silently and indefinitely. That is exactly what
// happened between 2026-08-15 and 2026-08-19: an oversized batch made the
// sync throw, and because the cursor only advances after a fully
// successful run, every later webhook replayed the identical failure.
// Balances kept refreshing on their own hourly cron throughout, so the app
// went on showing a live balance next to a ledger frozen five days back.
//
// This walks every active Item on a slow schedule and syncs it exactly as
// a webhook would. It is a floor, not a replacement: the webhook still
// delivers within seconds of Plaid having data, and Plaid only refreshes
// an Item a few times a day, so polling harder would mostly buy empty
// deltas. Balances come along for free -- syncItemTransactions piggybacks
// refreshAccountBalances onto every successful sync.
//
// Clients are injected rather than constructed here, for the same reason
// they are in syncItemTransactions.ts: both factories read Deno.env, and
// importing either as a value would make this file impossible to load
// under Node and therefore impossible to unit test.
import type { plaidClient } from "./plaid.ts";
import type { supabaseAdmin } from "./supabaseAdmin.ts";
import { syncItemTransactions } from "./syncItemTransactions.ts";

export async function resyncItems(
  db: ReturnType<typeof supabaseAdmin>,
  client: ReturnType<typeof plaidClient>
) {
  const { data: items, error } = await db
    .from("plaid_items")
    .select("item_id")
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to list plaid_items for resync: ${error.message}`);
  }

  let resynced = 0;
  let failed = 0;

  // Sequential, unlike plaid-balance-refresh's Promise.allSettled: a
  // transaction sync can page through /transactions/sync several times per
  // Item, and Plaid rate limits per Item -- the outage this exists to
  // catch was drawing 429s by re-pulling the same backlog on every retry.
  //
  // Each Item is caught individually. A resync that gave up on the first
  // failure would be a safety net that stops working precisely when one
  // Item is broken, which is when it is needed.
  for (const item of items || []) {
    try {
      await syncItemTransactions(item.item_id, client, db);
      resynced++;
    } catch (err) {
      failed++;
      console.error(`Scheduled resync failed for item ${item.item_id}`, err);
    }
  }

  return { resynced, failed };
}
