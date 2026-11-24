-- RLS + check_and_increment_query_rate_limit() on public.query_rate_limits.
--
-- This table has zero RLS policies for any client role -- the only
-- sanctioned access path is the SECURITY DEFINER function below, scoped
-- internally to auth.uid(). These tests assert both halves: direct table
-- access is denied, and the function itself only ever touches the
-- caller's own row.
--
-- Wrapped in a transaction and rolled back by run.sh.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid');

select test.become('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------
-- No policy means no direct access, even to your own (nonexistent) row
-- ---------------------------------------------------------------------
select test.assert_equals(
  (select count(*) from public.query_rate_limits)::int, 0,
  'alice cannot see any row directly (no SELECT policy)'
);

do $$
begin
  insert into public.query_rate_limits (user_id, count) values ('11111111-1111-1111-1111-111111111111', 1);
  raise exception 'ASSERTION FAILED: alice inserted a query_rate_limits row directly';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- anon cannot call the function at all (EXECUTE revoked, see the
-- migration's own anon/authenticated grant lockdown)
-- ---------------------------------------------------------------------
select test.become_anon();

do $$
begin
  perform public.check_and_increment_query_rate_limit();
  raise exception 'ASSERTION FAILED: anon executed check_and_increment_query_rate_limit()';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- A signed-in user is allowed under the limit, and the count increments.
-- The function takes no arguments -- see
-- 20261124000000_fix_query_rate_limit_param_bypass.sql for why: a
-- threshold/window the caller could supply was directly callable via
-- PostgREST by any authenticated user, who could pass p_window_seconds=0
-- to reset their own count before every real request and never be
-- throttled. So this test exercises the real fixed limit (20 per 300s)
-- rather than a caller-chosen one.
-- ---------------------------------------------------------------------
select test.become('11111111-1111-1111-1111-111111111111');

do $$
begin
  for i in 1..20 loop
    if not (select allowed from public.check_and_increment_query_rate_limit()) then
      raise exception 'ASSERTION FAILED: alice''s call #% this window was blocked', i;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- The 21st call in the same window is blocked, with a positive retry-after
-- ---------------------------------------------------------------------
select test.assert_equals(
  (select allowed from public.check_and_increment_query_rate_limit()), false,
  'alice''s 21st call this window is blocked'
);
select test.assert(
  (select retry_after_seconds from public.check_and_increment_query_rate_limit()) > 0,
  'a blocked call reports a positive retry_after_seconds'
);

-- ---------------------------------------------------------------------
-- The function takes no parameters any more, so there is nothing left
-- for a caller to override -- confirm the old two-arg overload is gone,
-- not just shadowed.
-- ---------------------------------------------------------------------
do $$
begin
  perform public.check_and_increment_query_rate_limit(999999, 0);
  raise exception 'ASSERTION FAILED: the two-argument overload still exists';
exception
  when undefined_function then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- Bob's own window is independent of alice's -- her being rate-limited
-- doesn't block him
-- ---------------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');

select test.assert_equals(
  (select allowed from public.check_and_increment_query_rate_limit()), true,
  'bob is unaffected by alice''s rate limit'
);
