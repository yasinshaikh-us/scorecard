-- check_and_increment_query_rate_limit(p_max_requests, p_window_seconds)
-- took its threshold and window as caller-supplied arguments. The
-- function is SECURITY DEFINER and granted EXECUTE to `authenticated`,
-- which means it's exposed as a PostgREST RPC endpoint
-- (rest/v1/rpc/check_and_increment_query_rate_limit) that any signed-in
-- client can call directly with its own choice of arguments -- not just
-- through the `query` Edge Function, which always calls it with no body
-- (so the 20/300 defaults apply there).
--
-- That let any authenticated user bypass the limiter entirely: call the
-- RPC directly with p_window_seconds=0 (or a huge p_max_requests) right
-- before each real question. p_window_seconds=0 makes the function treat
-- its own window as already elapsed, so it resets window_start=now(),
-- count=1 on every call -- then the next default-args call from the real
-- `query` function sees a freshly-reset count and always reports
-- allowed=true. Verified directly against the SECURITY DEFINER function
-- as an authenticated user: 19 real-shaped calls, one direct call with
-- (999999, 0), and the window resets to count=1 -- unlimited billed
-- Anthropic calls, no admin access needed.
--
-- Fix: the threshold and window stop being arguments at all, so there is
-- nothing for a caller to override. They become fixed constants inside
-- the function body. Changing a Postgres function's parameter list isn't
-- an in-place `create or replace` -- the old two-arg overload has to be
-- dropped explicitly or it keeps existing (and keeps being callable)
-- alongside the new one.

drop function if exists public.check_and_increment_query_rate_limit(integer, integer);

create function public.check_and_increment_query_rate_limit()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Fixed, not caller-supplied -- see the migration comment above for why.
  c_max_requests constant integer := 20;
  c_window_seconds constant integer := 300;
  v_user_id uuid := auth.uid();
  v_window_start timestamptz;
  v_count integer;
  v_now timestamptz := now();
  v_window interval := make_interval(secs => c_window_seconds);
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

  if v_count > c_max_requests then
    return query select false, greatest(0, ceil(extract(epoch from (v_window_start + v_window - v_now)))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

-- Same lockdown as the original migration: Supabase grants EXECUTE on
-- every new public-schema function to anon/authenticated by default, and
-- this one is SECURITY DEFINER, so anon needs it revoked explicitly.
revoke execute on function public.check_and_increment_query_rate_limit() from public;
revoke execute on function public.check_and_increment_query_rate_limit() from anon;
grant execute on function public.check_and_increment_query_rate_limit() to authenticated;
