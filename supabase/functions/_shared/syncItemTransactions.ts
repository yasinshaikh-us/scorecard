// Pulls everything new since the item's stored cursor via
// /transactions/sync and upserts it into public.transactions.
//
// Sign convention: Plaid's `amount` is positive for money leaving the
// account and negative for money coming in. This app stores the opposite
// (src/App.jsx / src/logic.js treat Amount < 0 as an expense, > 0 as
// income — see the manually-imported rows), so we negate it on the way in.

import { plaidClient } from "./plaid.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { applyCategoryRules, type CategoryRule } from "./categoryRules.ts";
import { refreshAccountBalances } from "./refreshAccountBalances.ts";

function categoryFor(tx: any) {
  return tx.personal_finance_category?.primary || tx.category?.join(" > ") || "Uncategorized";
}

function payeeFor(tx: any) {
  return tx.merchant_name || tx.name || "Unknown";
}

// Plaid's personal_finance_category.primary is TRANSFER_IN / TRANSFER_OUT
// for money moving between the user's own linked accounts (as opposed to
// real spending or income). Flagging these lets the query layer exclude
// them from spend/income totals by default -- see the is_transfer column
// migration for why that matters once a user has more than one account.
function isTransferFor(tx: any) {
  const primary = tx.personal_finance_category?.primary;
  return primary === "TRANSFER_IN" || primary === "TRANSFER_OUT";
}

export async function syncItemTransactions(itemId: string) {
  const db = supabaseAdmin();
  const client = plaidClient();

  const { data: item, error: itemError } = await db
    .from("plaid_items")
    .select("id, user_id, access_token, cursor")
    .eq("item_id", itemId)
    .maybeSingle();

  if (itemError) {
    throw new Error(`Failed to look up plaid_items row for item_id=${itemId}: ${itemError.message}`);
  }
  if (!item) {
    // A disconnected/revoked Item can still have webhooks in flight at
    // Plaid -- there's nothing to sync for it anymore, and treating this
    // as an error would make Plaid keep retrying a webhook that can never
    // succeed. No-op instead of throwing.
    console.warn(`Ignoring webhook for unknown item_id=${itemId} (likely already disconnected)`);
    return { added: 0, modified: 0, removed: 0, skipped: true };
  }

  let cursor = item.cursor;
  let hasMore = true;
  const added: any[] = [];
  const modified: any[] = [];
  const removed: any[] = [];

  while (hasMore) {
    const resp = await client.transactionsSync({
      access_token: item.access_token,
      cursor: cursor || undefined,
    });

    added.push(...resp.data.added);
    modified.push(...resp.data.modified);
    removed.push(...resp.data.removed);
    hasMore = resp.data.has_more;
    cursor = resp.data.next_cursor;
  }

  const { data: rules, error: rulesError } = await db
    .from("category_rules")
    .select("match_field, match_value, set_category, set_payee")
    .eq("user_id", item.user_id)
    .eq("enabled", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (rulesError) throw rulesError;

  // Plaid's sync stream covers every account under this Item, including
  // any plaid-exchange deliberately didn't record as a plaid_accounts row
  // because it was recognized as a duplicate of an already-linked
  // real-world account (see api/plaid-exchange.js). Without this filter,
  // that account's transactions would still get upserted here under a
  // fresh plaid_transaction_id -- recreating the same duplicate-ledger
  // bug through the sync path instead of at link time.
  const candidateAccountIds = [...new Set([...added, ...modified].map((tx: any) => tx.account_id))];
  let trackedAccountIds = new Set<string>();
  if (candidateAccountIds.length > 0) {
    const { data: tracked, error: trackedError } = await db
      .from("plaid_accounts")
      .select("account_id")
      .in("account_id", candidateAccountIds);
    if (trackedError) throw trackedError;
    trackedAccountIds = new Set((tracked || []).map((a) => a.account_id));
  }

  const upserts = [...added, ...modified].filter((tx: any) => trackedAccountIds.has(tx.account_id)).map((tx) => {
    const rawPayee = payeeFor(tx);
    const rawCategory = categoryFor(tx);
    const { category, payee } = applyCategoryRules(rawPayee, rawCategory, (rules || []) as CategoryRule[]);

    return {
      plaid_transaction_id: tx.transaction_id,
      plaid_account_id: tx.account_id,
      user_id: item.user_id,
      date: tx.date,
      raw_payee: rawPayee,
      raw_category: rawCategory,
      payee,
      category,
      amount: -tx.amount,
      source: "plaid",
      is_transfer: isTransferFor(tx),
    };
  });

  if (upserts.length > 0) {
    const { error: upsertError } = await db
      .from("transactions")
      .upsert(upserts, { onConflict: "plaid_transaction_id" });
    if (upsertError) throw upsertError;
  }

  if (removed.length > 0) {
    const removedIds = removed.map((tx) => tx.transaction_id);
    const { error: deleteError } = await db
      .from("transactions")
      .delete()
      .in("plaid_transaction_id", removedIds);
    if (deleteError) throw deleteError;
  }

  const { error: cursorUpdateError } = await db
    .from("plaid_items")
    .update({ cursor, updated_at: new Date().toISOString() })
    .eq("id", item.id);
  if (cursorUpdateError) throw cursorUpdateError;

  // Piggyback a balance refresh onto every transaction webhook -- Plaid's
  // Balance product has no webhook of its own, so this is what keeps
  // balances near-real-time instead of waiting up to an hour for the next
  // plaid-balance-refresh cron tick. Best-effort: a balance-refresh
  // failure shouldn't fail the (already-successful) transaction sync or
  // cause Plaid to retry the webhook.
  try {
    await refreshAccountBalances(db, client, item);
  } catch (err) {
    console.error(`Balance refresh failed for item ${itemId}`, err);
  }

  return { added: added.length, modified: modified.length, removed: removed.length };
}
