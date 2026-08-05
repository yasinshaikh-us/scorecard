-- Perf fix flagged by Supabase's own advisor (auth_rls_initplan): every
-- RLS policy below compares `auth.uid() = user_id` directly, which
-- Postgres's planner cannot treat as a constant -- it re-evaluates the
-- auth.uid() function call once per row scanned instead of once per
-- query. Wrapping it as `(select auth.uid())` lets the planner fold it
-- into an InitPlan, evaluated exactly once and then reused as a plain
-- constant for the rest of the scan.
--
-- This costs nothing at today's per-user row counts, but scales with
-- both rows-returned-per-query and concurrent-query-volume -- exactly
-- the two things "more users" pushes on. Pure query-rewrite: no
-- behavior change, same access control, same policy names.
--
-- Applied directly to the live project (bidorjtgbhuihppsznkc) via the
-- Supabase MCP `apply_migration` tool, mirroring this file for
-- version-control history -- same pattern as
-- 20260730231500_add_user_id_and_rls_to_transactions.sql.

drop policy "Users manage their own category rules" on public.category_rules;
create policy "Users manage their own category rules"
  on public.category_rules
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy "Users read their own account balances" on public.plaid_account_balances;
create policy "Users read their own account balances"
  on public.plaid_account_balances
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users read their own plaid accounts" on public.plaid_accounts;
create policy "Users read their own plaid accounts"
  on public.plaid_accounts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users read their own plaid item status" on public.plaid_items;
create policy "Users read their own plaid item status"
  on public.plaid_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users read their own transactions" on public.transactions;
create policy "Users read their own transactions"
  on public.transactions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users update their own transactions" on public.transactions;
create policy "Users update their own transactions"
  on public.transactions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
