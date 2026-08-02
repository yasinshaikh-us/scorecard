-- The client needs to know "has this user linked a bank yet" (to decide
-- whether to launch the Link flow on first login) without ever being able
-- to read access_token or cursor. Postgres column-level grants make that
-- safe to do with a normal RLS select policy: even a malicious client
-- selecting `access_token` explicitly gets a permission-denied error, RLS
-- row-matching aside — the column grant is enforced independently.

grant select (id, institution_name, status, created_at) on public.plaid_items to authenticated;

create policy "Users read their own plaid item status"
  on public.plaid_items
  for select
  to authenticated
  using (auth.uid() = user_id);
