// One-shot historical backfill from /transactions/get, for history that
// /transactions/sync was never able to deliver.
//
// WHY THIS EXISTS
//
// The transaction path is cursor-driven: syncItemTransactions asks
// /transactions/sync for everything since plaid_items.cursor, and once a
// batch is consumed the cursor moves past it forever. That is the right
// design for steady-state ingest and it has exactly one failure mode it
// cannot repair by itself -- a historical backfill that was lost while
// the sync path was broken. The Chase Item here was linked on 2026-08-15,
// which is inside the 2026-08-15..2026-08-19 window the sync path "sat
// broken and unnoticed" (see the resync-cron migration's own header), and
// its HISTORICAL_UPDATE went missing in it. Plaid still holds 2,747
// transactions back to 2024-09-11 for the Item; the ledger only ever
// received 410, from 2026-05-05 on.
//
// Resetting the cursor is the obvious repair and the wrong one: it
// re-delivers the whole backlog into a table that already holds a manual
// CSV import of the same years, so it would fix a hole by creating
// thousands of duplicates.
//
// So this takes an explicit date range instead, and dedups on the way IN
// rather than cleaning up afterwards -- a duplicate is never written.
//
// DEDUP RULE: date + amount, matched one-for-one.
//
// Deliberately the same rule supabase/plaid_duplicate_reconciliation.sql
// settled on for this exact manual/Plaid overlap, and the same one
// syncItemTransactions already applies on a relinked account's boundary
// date. Payee text is not comparable across the two sources ("Amazon" in
// the CSV vs "AMAZON.COM*1AB23" from Plaid), and date + amount are the
// two fields least likely to have been transcribed differently.
//
// Matches are CONSUMED one per candidate, not treated as a set: two
// genuine same-day, same-amount transactions must not collapse into one.
//
// Unlike the reconciliation script this deletes nothing. Where the ledger
// already has a row for a date+amount, the existing row wins and the
// Plaid one is skipped -- so hand-applied categories survive, and the
// only rows written are ones the ledger was actually missing.
//
// Same auth posture as plaid-transaction-resync: the project's
// service-role key, never an end user. DRY RUN unless the body says
// {"commit": true}.

import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { applyCategoryRules, type CategoryRule } from "../_shared/categoryRules.ts";

// Plaid's own per-request maximum for /transactions/get.
const PAGE_SIZE = 500;
const INSERT_CHUNK_SIZE = 500;

function categoryFor(tx: any) {
  return tx.personal_finance_category?.primary || tx.category?.join(" > ") || "Uncategorized";
}

function payeeFor(tx: any) {
  return tx.merchant_name || tx.name || "Unknown";
}

// Mirrors syncItemTransactions: TRANSFER_IN/OUT only counts as an
// internal transfer once there are two tracked accounts for the money to
// move between, otherwise it is real spend or income.
function isTransferFor(tx: any, linkedAccountCount: number) {
  const primary = tx.personal_finance_category?.primary;
  return (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") && linkedAccountCount >= 2;
}

const amountKey = (date: string, amount: number) => `${date}|${amount.toFixed(2)}`;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const commit = body.commit === true;
    const startDate: string = body.start_date;
    const endDate: string = body.end_date;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || "")) {
      return new Response(JSON.stringify({ error: "start_date and end_date (YYYY-MM-DD) are required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const db = supabaseAdmin();
    const plaid = plaidClient();

    const { data: items, error: itemsError } = await db
      .from("plaid_items")
      .select("id, item_id, user_id, institution_name, access_token")
      .eq("status", "active");
    if (itemsError) throw new Error(`plaid_items lookup failed: ${itemsError.message}`);

    const report: any[] = [];

    for (const item of items || []) {
      // Only accounts this app actually tracks. plaid-exchange leaves a
      // recognised-duplicate account out of plaid_accounts on purpose,
      // and pulling its history in here would recreate the very
      // duplicate-ledger bug that omission exists to prevent.
      const { data: accounts, error: accountsError } = await db
        .from("plaid_accounts")
        .select("account_id")
        .eq("user_id", item.user_id);
      if (accountsError) throw accountsError;
      const trackedAccountIds = new Set((accounts || []).map((a: any) => a.account_id));

      const { data: rules, error: rulesError } = await db
        .from("category_rules")
        .select("match_field, match_value, set_category, set_payee")
        .eq("user_id", item.user_id)
        .eq("enabled", true)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (rulesError) throw rulesError;

      // Every Plaid transaction in the range, paged.
      const fetched: any[] = [];
      let offset = 0;
      while (true) {
        const resp = await plaid.transactionsGet({
          access_token: item.access_token,
          start_date: startDate,
          end_date: endDate,
          options: { count: PAGE_SIZE, offset },
        });
        fetched.push(...resp.data.transactions);
        if (fetched.length >= resp.data.total_transactions || resp.data.transactions.length === 0) break;
        offset = fetched.length;
      }

      const candidates = fetched.filter((tx: any) => trackedAccountIds.has(tx.account_id));

      // Everything the ledger already holds in this range, for this user.
      // Paged for the same reason fetchAllRows is: the Data API caps a
      // response at the project's Max Rows no matter what is asked for,
      // and silently returning half the ledger here would mean writing
      // duplicates of the half that was not looked at.
      const existing: any[] = [];
      let from = 0;
      while (true) {
        const { data: page, error: existingError } = await db
          .from("transactions")
          .select("id, date, amount, plaid_transaction_id")
          .eq("user_id", item.user_id)
          .gte("date", startDate)
          .lte("date", endDate)
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (existingError) throw existingError;
        existing.push(...(page || []));
        if (!page || page.length < 1000) break;
        from += 1000;
      }

      const alreadySynced = new Set(
        existing.filter((r) => r.plaid_transaction_id).map((r) => r.plaid_transaction_id)
      );
      // Multiset: how many existing rows sit at each date+amount, so each
      // one can absorb exactly one incoming transaction.
      const availableByKey = new Map<string, number>();
      for (const r of existing) {
        const key = amountKey(r.date, Number(r.amount));
        availableByKey.set(key, (availableByKey.get(key) || 0) + 1);
      }

      const toInsert: any[] = [];
      let skippedAlreadySynced = 0;
      const skippedDuplicate: any[] = [];

      // Oldest first, so that when several incoming transactions compete
      // for the same date+amount the earlier-listed one is matched first
      // and the outcome does not depend on Plaid's page ordering.
      for (const tx of candidates.slice().sort((a: any, b: any) => a.date.localeCompare(b.date))) {
        if (alreadySynced.has(tx.transaction_id)) {
          skippedAlreadySynced++;
          continue;
        }
        const key = amountKey(tx.date, -tx.amount);
        const remaining = availableByKey.get(key) || 0;
        if (remaining > 0) {
          availableByKey.set(key, remaining - 1);
          skippedDuplicate.push(tx);
          continue;
        }

        const rawPayee = payeeFor(tx);
        const rawCategory = categoryFor(tx);
        const { category, payee } = applyCategoryRules(rawPayee, rawCategory, (rules || []) as CategoryRule[]);

        toInsert.push({
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
          is_transfer: isTransferFor(tx, trackedAccountIds.size),
          pending: !!tx.pending,
        });
      }

      const byMonth: Record<string, any> = {};
      for (const r of toInsert) {
        const m = r.date.slice(0, 7);
        byMonth[m] ||= { insert: 0, credits: 0, debits: 0, dup: 0 };
        byMonth[m].insert++;
        if (r.amount > 0) byMonth[m].credits++;
        else byMonth[m].debits++;
      }
      for (const tx of skippedDuplicate) {
        const m = tx.date.slice(0, 7);
        byMonth[m] ||= { insert: 0, credits: 0, debits: 0, dup: 0 };
        byMonth[m].dup++;
      }

      let inserted = 0;
      if (commit && toInsert.length > 0) {
        for (const rows of chunk(toInsert, INSERT_CHUNK_SIZE)) {
          // Still an upsert on plaid_transaction_id: if this is re-run,
          // or raced with a webhook that delivered the same transaction,
          // the row is updated rather than duplicated.
          const { error: insertError } = await db
            .from("transactions")
            .upsert(rows, { onConflict: "plaid_transaction_id" });
          if (insertError) throw insertError;
          inserted += rows.length;
        }
      }

      report.push({
        item_id: item.item_id,
        institution: item.institution_name,
        range: { start: startDate, end: endDate },
        plaid_returned: fetched.length,
        on_tracked_accounts: candidates.length,
        skipped_already_synced: skippedAlreadySynced,
        skipped_duplicate_of_existing: skippedDuplicate.length,
        would_insert: toInsert.length,
        would_insert_credits: toInsert.filter((r) => r.amount > 0).length,
        would_insert_debits: toInsert.filter((r) => r.amount < 0).length,
        inserted,
        by_month: byMonth,
      });
    }

    return new Response(JSON.stringify({ dry_run: !commit, items: report }, null, 2), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    const detail = err?.response?.data ?? String(err?.message ?? err);
    console.error("plaid-backfill failed", detail);
    return new Response(JSON.stringify({ error: detail }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
