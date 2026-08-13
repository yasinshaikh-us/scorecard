-- RLS on public.transactions.
--
-- README.md states plainly that "Postgres enforces the isolation, not app
-- code" -- these are the tests behind that claim. They run as the real
-- `authenticated` role with a real auth.uid(), the same way PostgREST runs
-- a signed-in request, so a pass here means the policy genuinely stops
-- cross-user reads rather than the app merely never asking for them.
--
-- Wrapped in a transaction and rolled back by run.sh.

-- Two real users.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid');

-- Seeded as the table owner (bypasses RLS), standing in for the
-- service-role sync path that actually writes these rows.
insert into public.transactions (date, payee, category, amount, user_id) values
  ('2026-01-01', 'Alice Coffee', 'Dining', -5.00, '11111111-1111-1111-1111-111111111111'),
  ('2026-01-02', 'Alice Rent',   'Rent',   -1000.00, '11111111-1111-1111-1111-111111111111'),
  ('2026-01-03', 'Bob Coffee',   'Dining', -7.00, '22222222-2222-2222-2222-222222222222'),
  -- A pre-auth row: SCHEMA.md notes user_id is nullable only because rows
  -- predate the column. It must belong to nobody, not to everybody.
  ('2025-06-01', 'Legacy Row',   'Dining', -3.00, null);

-- ---------------------------------------------------------------------
-- Reads are scoped to the caller
-- ---------------------------------------------------------------------
select test.become('11111111-1111-1111-1111-111111111111');

select test.assert_equals(
  (select count(*) from public.transactions)::int, 2,
  'alice sees exactly her own two rows'
);

select test.assert_equals(
  (select count(*) from public.transactions where payee = 'Bob Coffee')::int, 0,
  'alice cannot see bob''s row even when naming it directly'
);

select test.assert_equals(
  (select count(*) from public.transactions where user_id is null)::int, 0,
  'a null-user_id legacy row is visible to no authenticated user'
);

-- ---------------------------------------------------------------------
-- Writes: UPDATE is allowed on own rows only
-- ---------------------------------------------------------------------
update public.transactions set payee = 'Edited By Alice' where payee = 'Alice Coffee';
select test.assert_equals(
  (select count(*) from public.transactions where payee = 'Edited By Alice')::int, 1,
  'alice can edit her own row (the payee/category inline edit path)'
);

-- Not an error, but zero rows matched: the USING clause filters bob's row
-- out before the update sees it.
update public.transactions set payee = 'Hacked' where payee = 'Bob Coffee';
select test.assert_equals(
  (select count(*) from public.transactions where payee = 'Hacked')::int, 0,
  'alice''s update cannot reach bob''s row'
);

-- ---------------------------------------------------------------------
-- Writes: reassigning ownership is blocked by WITH CHECK
-- ---------------------------------------------------------------------
-- Without a WITH CHECK clause a user could hand their own row to someone
-- else (or steal one) by rewriting user_id. This must raise, not silently
-- succeed.
do $$
begin
  update public.transactions
    set user_id = '22222222-2222-2222-2222-222222222222'
    where payee = 'Alice Rent';
  raise exception 'ASSERTION FAILED: alice reassigned her row to bob, WITH CHECK did not hold';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- Writes: INSERT and DELETE have no policy at all
-- ---------------------------------------------------------------------
-- SCHEMA.md: the app's only write path is a targeted UPDATE, so INSERT and
-- DELETE were deliberately left without policies. With RLS enabled, no
-- policy for a command means the command is denied -- the table-level
-- GRANT still exists, so this asserts RLS is doing the work, not the grant.
do $$
begin
  insert into public.transactions (date, payee, category, amount, user_id)
    values ('2026-02-01', 'Injected', 'Dining', -1.00, '11111111-1111-1111-1111-111111111111');
  raise exception 'ASSERTION FAILED: authenticated inserted a transaction; no INSERT policy should exist';
exception
  when insufficient_privilege then null;  -- expected
end $$;

delete from public.transactions where payee = 'Alice Rent';
select test.assert_equals(
  (select count(*) from public.transactions where payee = 'Alice Rent')::int, 1,
  'authenticated cannot delete a transaction (no DELETE policy) -- an unscoped delete must not wipe a ledger'
);

-- ---------------------------------------------------------------------
-- The other side: bob sees only his own
-- ---------------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');
select test.assert_equals(
  (select count(*) from public.transactions)::int, 1,
  'bob sees exactly his own row'
);
select test.assert_equals(
  (select count(*) from public.transactions where payee = 'Edited By Alice')::int, 0,
  'bob cannot see the row alice just edited'
);

-- ---------------------------------------------------------------------
-- Unauthenticated access
-- ---------------------------------------------------------------------
select test.become_anon();
select test.assert_equals(
  (select count(*) from public.transactions)::int, 0,
  'an anonymous visitor sees no transactions at all'
);

reset role;
