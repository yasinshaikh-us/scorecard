// READ-ONLY diagnostic. Asks Plaid how far back it will actually serve
// transactions for each active Item, and writes nothing anywhere.
//
// Exists because /transactions/sync only ever hands over what is new
// since the Item's cursor, so once the historical backfill has been
// consumed there is no way to ask "is there more history available?"
// without resetting the cursor -- and a cursor reset re-delivers the
// whole backlog into a table that already holds a manual import of the
// same period, which is precisely the duplication this is meant to avoid
// causing. /transactions/get takes an explicit date range and is the
// non-destructive way to ask the same question.
//
// Same auth posture as plaid-transaction-resync: invoked with the
// project's service-role key, never by an end user.

import { plaidClient } from "../_shared/plaid.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

// Plaid's ceiling for a Transactions history request. Asking for more
// than the Item was linked with does not retroactively widen it -- this
// is here to bound the question, not to change what Plaid holds.
const MAX_LOOKBACK_DAYS = 730;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const plaid = plaidClient();

    const { data: items, error } = await db
      .from("plaid_items")
      .select("item_id, institution_name, status, access_token")
      .eq("status", "active");

    if (error) throw new Error(`plaid_items lookup failed: ${error.message}`);

    const start = isoDaysAgo(MAX_LOOKBACK_DAYS);
    const end = isoDaysAgo(0);
    const report: any[] = [];

    for (const item of items || []) {
      // count: 1 is deliberate -- total_transactions answers "how many in
      // this range" without paging the whole history down, and a second
      // call at the last offset finds the oldest one Plaid will serve.
      const first = await plaid.transactionsGet({
        access_token: item.access_token,
        start_date: start,
        end_date: end,
        options: { count: 1, offset: 0 },
      });

      const total = first.data.total_transactions;
      let oldest: string | null = null;
      let oldestName: string | null = null;

      if (total > 0) {
        const last = await plaid.transactionsGet({
          access_token: item.access_token,
          start_date: start,
          end_date: end,
          options: { count: 1, offset: Math.max(total - 1, 0) },
        });
        oldest = last.data.transactions[0]?.date ?? null;
        oldestName = last.data.transactions[0]?.name ?? null;
      }

      report.push({
        item_id: item.item_id,
        institution: item.institution_name,
        requested_range: { start, end },
        total_transactions_available: total,
        oldest_available: oldest,
        oldest_example: oldestName,
        accounts: first.data.accounts.map((a: any) => ({
          account_id: a.account_id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
        })),
      });
    }

    return new Response(JSON.stringify({ probed_at: new Date().toISOString(), items: report }, null, 2), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    // Plaid errors carry the useful detail in the response body.
    const detail = err?.response?.data ?? String(err?.message ?? err);
    console.error("plaid-history-probe failed", detail);
    return new Response(JSON.stringify({ error: detail }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
