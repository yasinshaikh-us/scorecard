-- Grows the closed category set from 19 to 22: Insurance, Home Services
-- and Personal Care. Before this, life/auto/renter's insurance premiums,
-- cleaning/lawn/backflow services and barber/salon spend had no bucket in
-- the closed set, so any rule pointing at them would be clamped right back
-- to 'Miscellaneous' -- which is where most of what was left in
-- Miscellaneous was sitting.
--
-- Same body as 20260805000000_fix_transfer_flag_and_mortgage_rule.sql;
-- only allowed_categories changes. The new names are appended at the end
-- of the list, and the same order is mirrored in categoryRules.ts and
-- mobile/lib/categories.ts -- the mobile palette assigns colors by index,
-- so appending keeps every existing category's color unchanged.

create or replace function public.apply_category_rules()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  affected integer;
  total integer := 0;
  linked_account_count integer;
  allowed_categories text[] := array[
    'Income', 'Mortgage', 'Investments', 'Rent', 'Alimony', 'Taxes', 'Miscellaneous',
    'Dining', 'Shopping', 'Utilities', 'Groceries', 'Transport', 'Education', 'Health',
    'Cash', 'Travel', 'Software', 'Entertainment', 'Fees',
    'Insurance', 'Home Services', 'Personal Care'
  ];
begin
  update public.transactions
  set category = raw_category, payee = initcap(public.clean_payee(raw_payee))
  where user_id = auth.uid() and raw_category is not null and not manually_edited;

  for r in
    select * from public.category_rules
    where user_id = auth.uid() and enabled
    order by priority asc, created_at asc
  loop
    if r.match_field = 'payee' then
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and not manually_edited
        and raw_payee ilike '%' || r.match_value || '%';
    else
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and not manually_edited
        and raw_category ilike '%' || r.match_value || '%';
    end if;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  update public.transactions
  set category = 'Miscellaneous'
  where user_id = auth.uid()
    and not manually_edited
    and not (category = any(allowed_categories));

  -- See 20260805000000_fix_transfer_flag_and_mortgage_rule.sql for why
  -- this is conditioned on actually having a second tracked account.
  select count(*) into linked_account_count
  from public.plaid_accounts
  where user_id = auth.uid();

  update public.transactions
  set is_transfer = (raw_category in ('TRANSFER_IN', 'TRANSFER_OUT')) and linked_account_count >= 2
  where user_id = auth.uid()
    and not manually_edited
    and source = 'plaid';

  return total;
end;
$$;
