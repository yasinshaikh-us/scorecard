-- Security fix: Supabase grants broad column privileges to anon/authenticated
-- by default on every public-schema table, relying on RLS as the actual
-- gate. The narrow `grant select (id, institution_name, status, created_at)`
-- added in 20260802000200 was additive on top of that pre-existing broad
-- grant, not a replacement for it — GRANT never revokes. Combined with the
-- new RLS SELECT policy in that same migration, the net effect was that
-- authenticated users could read every column of their own plaid_items row,
-- including access_token and cursor. This had not yet been exploited (the
-- table was empty when found), but must be closed before any real access
-- token is stored.

revoke all on public.plaid_items from anon, authenticated;

grant select (id, institution_name, status, created_at) on public.plaid_items to authenticated;
