// Fetches an item's latest account balances from Plaid and upserts them
// into plaid_account_balances. Shared by the hourly plaid-balance-refresh
// cron (Plaid's Balance product has no webhook, so polling is the only
// option for accounts that haven't transacted recently) and
// syncItemTransactions (so a transaction webhook also refreshes the
// balance in the same round trip, instead of waiting up to an hour for
// the next cron tick).

import type { plaidClient } from "./plaid.ts";
import type { supabaseAdmin } from "./supabaseAdmin.ts";

export async function refreshAccountBalances(
  db: ReturnType<typeof supabaseAdmin>,
  client: ReturnType<typeof plaidClient>,
  item: { user_id: string; access_token: string }
) {
  const resp = await client.accountsBalanceGet({ access_token: item.access_token });

  const rows = resp.data.accounts.map((a) => ({
    account_id: a.account_id,
    user_id: item.user_id,
    available: a.balances.available,
    current: a.balances.current,
    iso_currency_code: a.balances.iso_currency_code,
    as_of: new Date().toISOString(),
  }));

  const { error } = await db.from("plaid_account_balances").upsert(rows, { onConflict: "account_id" });
  if (error) throw error;

  return rows.length;
}
