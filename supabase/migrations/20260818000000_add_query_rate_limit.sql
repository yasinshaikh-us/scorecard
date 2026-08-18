-- The `query` Edge Function calls Anthropic on every request, billed to
-- this app's API key, with no cap on how often a signed-in user can call
-- it -- a leaked/compromised token (or just a runaway client bug) can
-- drive unbounded Anthropic spend. This adds a small per-user sliding
-- window counter, enforced in the database so it can't be bypassed by
-- calling PostgREST directly instead of going through the Edge Function.
--
-- One row per user, reset whenever the window has elapsed. SECURITY
-- INVOKER + `auth.uid()` internally (no user_id parameter) mirrors
-- ledger_meta()/apply_category_rules(): a caller can only ever touch
-- their own row, never target another user's.

create table if not exists public.query_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.query_rate_limits enable row level security;

-- No policy grants SELECT/INSERT/UPDATE directly -- all access goes
-- through check_and_increment_query_rate_limit() below, which is the
-- only thing that needs to read or write this table.

create or replace function public.check_and_increment_query_rate_limit(
  p_max_requests integer default 20,
  p_window_seconds integer default 300
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window_start timestamptz;
  v_count integer;
  v_now timestamptz := now();
  v_window interval := make_interval(secs => p_window_seconds);
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.query_rate_limits (user_id, window_start, count)
  values (v_user_id, v_now, 1)
  on conflict (user_id) do update
    set window_start = case
          when public.query_rate_limits.window_start <= v_now - v_window
          then v_now
          else public.query_rate_limits.window_start
        end,
        count = case
          when public.query_rate_limits.window_start <= v_now - v_window
          then 1
          else public.query_rate_limits.count + 1
        end
  returning public.query_rate_limits.window_start, public.query_rate_limits.count
  into v_window_start, v_count;

  if v_count > p_max_requests then
    return query select false, greatest(0, ceil(extract(epoch from (v_window_start + v_window - v_now)))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

-- Supabase grants EXECUTE on every new public-schema function to
-- anon/authenticated by default (see 20260805020000_lock_down_purge_function.sql).
-- This function is SECURITY DEFINER, so leaving the anon grant in place
-- would let an unauthenticated API client call it directly via
-- PostgREST's rpc/ endpoint -- harmless here (it raises before touching
-- the table when auth.uid() is null) but still not the intended caller.
revoke execute on function public.check_and_increment_query_rate_limit(integer, integer) from public;
revoke execute on function public.check_and_increment_query_rate_limit(integer, integer) from anon;
grant execute on function public.check_and_increment_query_rate_limit(integer, integer) to authenticated;
