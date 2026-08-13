-- RLS and column-level grants on the Plaid tables.
--
-- The stakes here are higher than on transactions: plaid_items.access_token
-- is a live credential for the user's real bank connection, and cursor is
-- an internal sync bookmark. SCHEMA.md says both are service-role only,
-- enforced by a column-level GRANT rather than by RLS (RLS filters rows,
-- not columns). This file tests that grant directly -- it is the kind of
-- thing a later "grant select on plaid_items to authenticated" would
-- silently undo.
--
-- Wrapped in a transaction and rolled back by run.sh.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid');

insert into public.plaid_items (id, user_id, item_id, access_token, institution_id, institution_name, cursor, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'item-alice', 'access-sandbox-ALICE-SECRET', 'ins_1', 'Alice Bank', 'cursor-alice', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'item-bob', 'access-sandbox-BOB-SECRET', 'ins_2', 'Bob Bank', 'cursor-bob', 'active');

insert into public.plaid_accounts (item_id, user_id, account_id, name, mask, type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'acct-alice', 'Alice Checking', '1111', 'depository'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'acct-bob', 'Bob Checking', '2222', 'depository');

insert into public.plaid_account_balances (account_id, user_id, available, current, iso_currency_code) values
  ('acct-alice', '11111111-1111-1111-1111-111111111111', 100.00, 150.00, 'USD'),
  ('acct-bob', '22222222-2222-2222-2222-222222222222', 200.00, 250.00, 'USD');

select test.become('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------
-- plaid_items: readable columns, own rows only
-- ---------------------------------------------------------------------
select test.assert_equals(
  (select count(*) from public.plaid_items)::int, 1,
  'alice sees only her own linked item'
);

select test.assert_equals(
  (select institution_name from public.plaid_items), 'Alice Bank',
  'alice can read the institution name the Banks strip displays'
);

select test.assert_equals(
  (select status from public.plaid_items), 'active',
  'alice can read item status (the reconnect prompt depends on it)'
);

-- ---------------------------------------------------------------------
-- plaid_items: the secret columns are NOT readable
-- ---------------------------------------------------------------------
-- The single most important assertion in this file. access_token is a live
-- bank credential; if this ever starts passing silently, every signed-in
-- user can read their own (and the query shape makes it trivial to try
-- others').
do $$
declare leaked text;
begin
  select access_token into leaked from public.plaid_items;
  raise exception 'ASSERTION FAILED: authenticated read plaid_items.access_token (got %)', leaked;
exception
  when insufficient_privilege then null;  -- expected
end $$;

do $$
declare leaked text;
begin
  select cursor into leaked from public.plaid_items;
  raise exception 'ASSERTION FAILED: authenticated read plaid_items.cursor';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- A plain `select *` is what a careless client actually writes. It must
-- fail rather than quietly returning the secret columns.
do $$
begin
  perform * from public.plaid_items;
  raise exception 'ASSERTION FAILED: select * on plaid_items succeeded for authenticated';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- plaid_items: no client write path at all
-- ---------------------------------------------------------------------
-- Only SELECT has a policy. Every write goes through service-role code
-- (plaid-exchange, plaid-disconnect, plaid-webhook).
do $$
begin
  update public.plaid_items set status = 'disconnected' where item_id = 'item-alice';
  raise exception 'ASSERTION FAILED: authenticated updated plaid_items; no UPDATE policy should exist';
exception
  when insufficient_privilege then null;  -- expected
end $$;

do $$
begin
  insert into public.plaid_items (user_id, item_id, access_token)
    values ('11111111-1111-1111-1111-111111111111', 'item-forged', 'forged-token');
  raise exception 'ASSERTION FAILED: authenticated inserted into plaid_items';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- Note this raises rather than matching zero rows: the lockdown migration
-- revoked table-level privileges on plaid_items entirely and re-granted
-- only four columns for SELECT, so DELETE is refused before RLS is even
-- consulted. Stricter than the transactions table, where the grant still
-- exists and RLS alone does the stopping.
do $$
begin
  delete from public.plaid_items where item_id = 'item-alice';
  raise exception 'ASSERTION FAILED: authenticated deleted a plaid_item; disconnect is service-role only';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- plaid_accounts / plaid_account_balances: read own, write never
-- ---------------------------------------------------------------------
select test.assert_equals(
  (select count(*) from public.plaid_accounts)::int, 1,
  'alice sees only her own linked accounts'
);
select test.assert_equals(
  (select name from public.plaid_accounts), 'Alice Checking',
  'alice reads her own account name'
);

select test.assert_equals(
  (select count(*) from public.plaid_account_balances)::int, 1,
  'alice sees only her own balances'
);
select test.assert_equals(
  (select current from public.plaid_account_balances), 150.00,
  'alice reads her own balance figure'
);

-- Balances are written exclusively by the hourly cron and the sync
-- webhook, both service-role. A client editing its own balance would make
-- the displayed number meaningless.
-- Unlike plaid_items, this table keeps its table-level grant, so the
-- UPDATE is permitted at the privilege layer and RLS is what stops it:
-- with no UPDATE policy, no row is visible to update, so the statement
-- succeeds against zero rows. Asserting the VALUE is unchanged (rather
-- than expecting an error) is what actually pins the behavior.
update public.plaid_account_balances set current = 999999 where account_id = 'acct-alice';
select test.assert_equals(
  (select current from public.plaid_account_balances where account_id = 'acct-alice'), 150.00,
  'authenticated cannot change its own balance row (no UPDATE policy) -- displayed balances stay server-owned'
);

-- ---------------------------------------------------------------------
-- Cross-user isolation on every Plaid table
-- ---------------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');

select test.assert_equals(
  (select institution_name from public.plaid_items), 'Bob Bank',
  'bob sees his own institution, not alice''s'
);
select test.assert_equals(
  (select count(*) from public.plaid_accounts where account_id = 'acct-alice')::int, 0,
  'bob cannot see alice''s account by naming its id directly'
);
select test.assert_equals(
  (select count(*) from public.plaid_account_balances where account_id = 'acct-alice')::int, 0,
  'bob cannot see alice''s balance by naming her account id directly'
);

-- ---------------------------------------------------------------------
-- Anonymous access
-- ---------------------------------------------------------------------
select test.become_anon();

select test.assert_equals(
  (select count(*) from public.plaid_accounts)::int, 0,
  'an anonymous visitor sees no plaid accounts'
);
select test.assert_equals(
  (select count(*) from public.plaid_account_balances)::int, 0,
  'an anonymous visitor sees no balances'
);

-- SCHEMA.md: "No `anon` access at all" to plaid_items -- anon holds no
-- column grant whatsoever, so this fails on privilege rather than
-- returning an empty set.
do $$
begin
  perform institution_name from public.plaid_items;
  raise exception 'ASSERTION FAILED: anon read plaid_items.institution_name';
exception
  when insufficient_privilege then null;  -- expected
end $$;

reset role;
