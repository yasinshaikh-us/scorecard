// Fetches an item's latest account balances from Plaid and upserts them
// into plaid_account_balances. Shared by the hourly plaid-balance-refresh
// cron (Plaid's Balance product has no webhook, so polling is the only
// option for accounts that haven't transacted recently) and
// syncItemTransactions (so a transaction webhook also refreshes the
// balance in the same round trip, instead of waiting up to an hour for
// the next cron tick).
//
// Plaid's Balance product returns every account under the Item, including
// any that plaid-exchange deliberately chose not to track as a duplicate
// of an already-linked real-world account (see api/plaid-exchange.js).
// plaid_account_balances.account_id has a foreign key into plaid_accounts,
// so upserting an untracked account's balance would fail the whole batch
// -- filter to accounts we actually have a plaid_accounts row for first.

import type { plaidClient } from "./plaid.ts";
import type { supabaseAdmin } from "./supabaseAdmin.ts";

export async function refreshAccountBalances(
  db: ReturnType<typeof supabaseAdmin>,
  client: ReturnType<typeof plaidClient>,
  item: { user_id: string; access_token: string }
) {
  const resp = await client.accountsBalanceGet({ access_token: item.access_token });
  const accountIds = resp.data.accounts.map((a) => a.account_id);

  const { data: tracked, error: trackedError } = await db
    .from("plaid_accounts")
    .select("account_id")
    .in("account_id", accountIds);
  if (trackedError) throw trackedError;
  const trackedIds = new Set((tracked || []).map((a) => a.account_id));

  const rows = resp.data.accounts
    .filter((a) => trackedIds.has(a.account_id))
    .map((a) => ({
      account_id: a.account_id,
      user_id: item.user_id,
      available: a.balances.available,
      current: a.balances.current,
      iso_currency_code: a.balances.iso_currency_code,
      as_of: new Date().toISOString(),
    }));

  if (rows.length === 0) return 0;

  const { error } = await db.from("plaid_account_balances").upsert(rows, { onConflict: "account_id" });
  if (error) throw error;

  return rows.length;
}
