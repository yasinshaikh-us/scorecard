-- Add per-user ownership to transactions. RLS was already enabled with
-- no policies (service-role only); this adds the auth.uid()-scoped
-- policy for when real user accounts/client-side access exist.
--
-- Existing rows are left with user_id = NULL and stay readable only via
-- the service-role key used in api/transactions.js, which bypasses RLS.
--
-- Applied directly to the live project (bidorjtgbhuihppsznkc) via the
-- Supabase MCP `apply_migration` tool; this file mirrors that change
-- for version-control history and local/CLI parity.

alter table public.transactions
  add column user_id uuid references auth.users(id);

create index transactions_user_id_date_idx
  on public.transactions (user_id, date desc);

create policy "Users manage their own transactions"
  on public.transactions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
