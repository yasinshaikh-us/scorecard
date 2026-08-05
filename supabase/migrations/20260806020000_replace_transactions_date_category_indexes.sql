-- transactions_date_idx (date) and transactions_category_idx (category)
-- were standalone, table-wide indexes spanning every user's rows. Every
-- real query this app issues against `transactions` is user-scoped --
-- either via RLS's `auth.uid() = user_id` (api/transactions.js,
-- api/query.js's fetchAllRows/fetchLedgerMeta) or explicitly
-- (apply_category_rules()'s `where user_id = ...`) -- so neither index
-- was ever selective for the app's own access pattern; they only added
-- write-amplification (every Plaid-synced insert/upsert maintains both)
-- with no compensating read benefit.
--
-- Replaced with a single composite (user_id, category, date desc): the
-- same (user_id, date desc) prefix the existing transactions_user_id_
-- date_idx already serves, extended with category so a user-scoped
-- category lookup (or ledger_meta()'s per-user distinct-category scan)
-- can also be satisfied from the index without a heap scan.
--
-- Applied directly to the live project (bidorjtgbhuihppsznkc) via the
-- Supabase MCP `apply_migration` tool, mirroring this file for
-- version-control history.

drop index public.transactions_date_idx;
drop index public.transactions_category_idx;

create index transactions_user_id_category_date_idx
  on public.transactions (user_id, category, date desc);
