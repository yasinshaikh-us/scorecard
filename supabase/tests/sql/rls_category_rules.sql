-- RLS on public.category_rules.
--
-- This table is different from the others: it has a single FOR ALL policy,
-- so the client genuinely does insert/update/delete here (the Rules panel
-- is a real CRUD surface). That makes the WITH CHECK half of the policy
-- load-bearing in a way it isn't elsewhere -- without it a user could
-- author rules into someone else's account, and since rules rewrite
-- payees and categories on every sync, that is a write primitive against
-- another user's ledger.
--
-- Wrapped in a transaction and rolled back by run.sh.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid');

insert into public.category_rules (user_id, priority, match_field, match_value, set_category) values
  ('22222222-2222-2222-2222-222222222222', 100, 'payee', 'bobs-rule', 'Dining');

select test.become('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------
-- The happy path: a user really can manage their own rules
-- ---------------------------------------------------------------------
insert into public.category_rules (user_id, priority, match_field, match_value, set_category)
  values ('11111111-1111-1111-1111-111111111111', 50, 'payee', 'coffee', 'Dining');

select test.assert_equals(
  (select count(*) from public.category_rules)::int, 1,
  'alice sees her own rule and not bob''s'
);

update public.category_rules set set_category = 'Groceries' where match_value = 'coffee';
select test.assert_equals(
  (select set_category from public.category_rules where match_value = 'coffee'), 'Groceries',
  'alice can edit her own rule'
);

update public.category_rules set enabled = false where match_value = 'coffee';
select test.assert_equals(
  (select enabled from public.category_rules where match_value = 'coffee'), false,
  'alice can toggle her own rule (the enable/disable switch in the Rules panel)'
);

delete from public.category_rules where match_value = 'coffee';
select test.assert_equals(
  (select count(*) from public.category_rules)::int, 0,
  'alice can delete her own rule'
);

-- ---------------------------------------------------------------------
-- WITH CHECK: cannot author a rule into someone else's account
-- ---------------------------------------------------------------------
do $$
begin
  insert into public.category_rules (user_id, priority, match_field, match_value, set_category)
    values ('22222222-2222-2222-2222-222222222222', 1, 'payee', 'planted', 'Fees');
  raise exception 'ASSERTION FAILED: alice inserted a category rule owned by bob';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- USING: bob's existing rule is invisible and untouchable
-- ---------------------------------------------------------------------
select test.assert_equals(
  (select count(*) from public.category_rules where match_value = 'bobs-rule')::int, 0,
  'alice cannot see bob''s rule by naming it directly'
);

update public.category_rules set set_category = 'Fees' where match_value = 'bobs-rule';
select test.become('22222222-2222-2222-2222-222222222222');
select test.assert_equals(
  (select set_category from public.category_rules where match_value = 'bobs-rule'), 'Dining',
  'bob''s rule is unchanged after alice tried to rewrite it'
);

select test.become('11111111-1111-1111-1111-111111111111');
delete from public.category_rules where match_value = 'bobs-rule';
select test.become('22222222-2222-2222-2222-222222222222');
select test.assert_equals(
  (select count(*) from public.category_rules where match_value = 'bobs-rule')::int, 1,
  'bob''s rule survives alice''s delete attempt'
);

-- ---------------------------------------------------------------------
-- Reassigning ownership of an existing rule
-- ---------------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');
do $$
begin
  update public.category_rules
    set user_id = '11111111-1111-1111-1111-111111111111'
    where match_value = 'bobs-rule';
  raise exception 'ASSERTION FAILED: bob pushed his rule into alice''s account via user_id';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- ---------------------------------------------------------------------
-- Anonymous access
-- ---------------------------------------------------------------------
select test.become_anon();
select test.assert_equals(
  (select count(*) from public.category_rules)::int, 0,
  'an anonymous visitor sees no category rules'
);

reset role;
