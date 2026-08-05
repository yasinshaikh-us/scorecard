-- Narrows the "Users manage their own transactions" RLS policy from ALL
-- (SELECT/INSERT/UPDATE/DELETE) down to just SELECT + UPDATE. The app's
-- only write path against this table is a single targeted UPDATE by row
-- id (src/TransactionRow.jsx's payee/category edit) -- there is no
-- add-transaction or delete-transaction feature anywhere in the client.
-- Leaving INSERT/DELETE granted was pure unused headroom: a leaked/
-- stolen access token, a browser devtools session, or a future buggy
-- code path could otherwise issue a single unscoped DELETE and wipe a
-- user's entire transaction history in one call, with no confirmation
-- and no soft-delete. Splitting into two narrower policies removes that
-- capability without touching the one operation the app actually needs.
-- service_role (the Plaid sync path, apply_category_rules() is SECURITY
-- INVOKER and only ever UPDATEs) is entirely unaffected -- it bypasses
-- RLS regardless.
--
-- If insert/delete transaction features are ever added, add back
-- narrowly-scoped INSERT/DELETE policies at that point rather than
-- reverting to a blanket ALL.

drop policy "Users manage their own transactions" on public.transactions;

create policy "Users read their own transactions"
  on public.transactions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users update their own transactions"
  on public.transactions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
