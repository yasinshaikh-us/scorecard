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
// for any transaction that looks like money moving to/from another
// account -- that's as true of a mortgage payment, an alimony payment, or
// a brokerage funding transfer as it is of moving money between two
// accounts this app actually tracks. Excluding these from spend/income
// totals only makes sense to avoid double-counting a transfer between two
// *tracked* accounts (see apply_category_rules() and its migration for
// the full rationale) -- with fewer than 2 linked accounts there's no
// second tracked account for the money to land in, so nothing here can
// actually be double-counted, and it must count as real spend/income
// instead of silently disappearing.
function isTransferFor(tx: any, linkedAccountCount: number) {
  const primary = tx.personal_finance_category?.primary;
  return (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") && linkedAccountCount >= 2;
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

  const { count: linkedAccountCount, error: accountCountError } = await db
    .from("plaid_accounts")
    .select("account_id", { count: "exact", head: true })
    .eq("user_id", item.user_id);
  if (accountCountError) throw accountCountError;

  // Plaid's sync stream covers every account under this Item, including
  // any plaid-exchange deliberately didn't record as a plaid_accounts row
  // because it was recognized as a duplicate of an already-linked
  // real-world account (see api/plaid-exchange.js). Without this filter,
  // that account's transactions would still get upserted here under a
  // fresh plaid_transaction_id -- recreating the same duplicate-ledger
  // bug through the sync path instead of at link time.
  const candidateAccountIds = [...new Set([...added, ...modified].map((tx: any) => tx.account_id))];
  let trackedAccountIds = new Set<string>();
  const resyncAfterDateByAccountId = new Map<string, string>();
  if (candidateAccountIds.length > 0) {
    const { data: tracked, error: trackedError } = await db
      .from("plaid_accounts")
      .select("account_id, resync_after_date")
      .in("account_id", candidateAccountIds);
    if (trackedError) throw trackedError;
    for (const a of tracked || []) {
      trackedAccountIds.add(a.account_id);
      if (a.resync_after_date) resyncAfterDateByAccountId.set(a.account_id, a.resync_after_date);
    }
  }

  // A transaction the user has directly edited (payee/category set by
  // hand rather than by a rule -- see manually_edited on public.transactions)
  // must not get silently clobbered the next time Plaid reports this same
  // transaction as "modified" (e.g. a pending -> posted transition).
  // Once a row is manually edited, sync stops touching it entirely.
  const candidateTransactionIds = [...added, ...modified].map((tx: any) => tx.transaction_id);
  const manuallyEditedIds = new Set<string>();
  if (candidateTransactionIds.length > 0) {
    const { data: edited, error: editedError } = await db
      .from("transactions")
      .select("plaid_transaction_id")
      .in("plaid_transaction_id", candidateTransactionIds)
      .eq("manually_edited", true);
    if (editedError) throw editedError;
    for (const e of edited || []) manuallyEditedIds.add(e.plaid_transaction_id);
  }

  // A relinked account (recognized via plaid_account_fingerprints in
  // api/plaid-exchange.js as one this user had before, under a now-
  // disconnected account_id) carries a resync_after_date: the latest date
  // we already have this real account's history through. Plaid's fresh
  // Item does a full historical resync on first sync regardless -- this
  // skips re-inserting the part of that resync we already have, so a
  // disconnect-then-relink doesn't duplicate the account's whole history.
  //
  // The boundary date itself is included (>=, not >) rather than skipped
  // outright: Plaid's `date` has no time component, so a transaction that
  // posted later the same calendar day as our last-synced transaction --
  // but *after* the user disconnected -- shares that date and would
  // otherwise be silently dropped forever, never resynced. Since that one
  // day mixes transactions we already have with ones we don't, it can't
  // be resolved by date alone -- see the boundary-date dedup below.
  const boundaryDates = [...new Set(resyncAfterDateByAccountId.values())];
  const existingOnBoundaryDate = new Map<string, number>(); // `${date}|${amount}` -> remaining count
  if (boundaryDates.length > 0) {
    const { data: existing, error: existingError } = await db
      .from("transactions")
      .select("date, amount")
      .eq("user_id", item.user_id)
      .eq("source", "plaid")
      .in("date", boundaryDates);
    if (existingError) throw existingError;
    for (const row of existing || []) {
      const key = `${row.date}|${Number(row.amount).toFixed(2)}`;
      existingOnBoundaryDate.set(key, (existingOnBoundaryDate.get(key) || 0) + 1);
    }
  }

  const upserts = [...added, ...modified]
    .filter((tx: any) => trackedAccountIds.has(tx.account_id))
    .filter((tx: any) => !manuallyEditedIds.has(tx.transaction_id))
    .filter((tx: any) => {
      const boundary = resyncAfterDateByAccountId.get(tx.account_id);
      return !boundary || tx.date >= boundary;
    })
    .filter((tx: any) => {
      // Only the boundary date itself is ambiguous (see comment above) --
      // anything strictly after it is guaranteed new, since the boundary
      // is defined as the latest date we already had. Match by date +
      // amount (mirrors supabase/plaid_duplicate_reconciliation.sql's
      // approach for the same kind of manual/Plaid overlap), consuming
      // one already-synced match per incoming transaction so two genuine
      // same-day, same-amount transactions aren't collapsed into one.
      const boundary = resyncAfterDateByAccountId.get(tx.account_id);
      if (!boundary || tx.date !== boundary) return true;
      const key = `${tx.date}|${(-tx.amount).toFixed(2)}`;
      const remaining = existingOnBoundaryDate.get(key) || 0;
      if (remaining > 0) {
        existingOnBoundaryDate.set(key, remaining - 1);
        return false;
      }
      return true;
    })
    .map((tx) => {
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
        is_transfer: isTransferFor(tx, linkedAccountCount || 0),
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
