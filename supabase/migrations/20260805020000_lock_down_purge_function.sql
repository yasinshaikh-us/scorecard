-- Supabase grants EXECUTE on every new public-schema function to
-- anon/authenticated by default -- `revoke ... from public` in
-- 20260805010000_purge_stale_disconnected_transactions.sql didn't touch
-- those role-specific grants (confirmed live via has_function_privilege).
-- Since purge_stale_disconnected_transactions() is SECURITY DEFINER and
-- takes no parameters to scope it to a caller, leaving those grants in
-- place would let any authenticated (or even anonymous) API client
-- trigger a cross-user purge directly via PostgREST's rpc/ endpoint.
-- Revoke explicitly from both; service_role (the only real caller, via
-- the cron job) keeps its default access.
revoke execute on function public.purge_stale_disconnected_transactions() from anon;
revoke execute on function public.purge_stale_disconnected_transactions() from authenticated;
