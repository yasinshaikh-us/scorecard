-- Perf fix flagged by Supabase's own advisor (unindexed_foreign_keys):
-- every RLS policy on these tables filters by user_id (see SCHEMA.md's
-- Security model), but none of them had a covering index on it -- so
-- each RLS-scoped read was a sequential scan of every user's rows in
-- the table, not just the caller's own. Negligible today (each of these
-- tables holds a handful of rows total across all users), but this is
-- exactly the kind of thing that's free to add now and expensive to
-- retrofit once these tables have grown with the user base.
--
-- category_rules gets a composite (user_id, priority) rather than a
-- bare user_id index -- CategoryRulesPanel.jsx always reads a user's
-- rules RLS-scoped *and* ordered by priority in the same query, so one
-- index covers both instead of a filter followed by a separate sort.
--
-- plaid_accounts additionally gets an index on item_id: it's a foreign
-- key into plaid_items with no covering index of its own, used whenever
-- a Plaid Item's accounts are looked up (e.g. api/plaid-disconnect.js
-- listing every account under an Item being disconnected).
--
-- Applied directly to the live project (bidorjtgbhuihppsznkc) via the
-- Supabase MCP `apply_migration` tool, mirroring this file for
-- version-control history.

create index category_rules_user_id_priority_idx
  on public.category_rules (user_id, priority);

create index plaid_accounts_user_id_idx
  on public.plaid_accounts (user_id);

create index plaid_accounts_item_id_idx
  on public.plaid_accounts (item_id);

create index plaid_account_balances_user_id_idx
  on public.plaid_account_balances (user_id);

create index plaid_auth_numbers_user_id_idx
  on public.plaid_auth_numbers (user_id);

create index plaid_items_user_id_idx
  on public.plaid_items (user_id);

create index plaid_disconnected_accounts_user_id_idx
  on public.plaid_disconnected_accounts (user_id);
