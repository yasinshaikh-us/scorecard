-- Two additions to the category rules engine:
--
-- 1. A 'Transfer' category (closed set grows from 22 to 23) for money moving
--    between the user's own accounts and deposits -- payments to/from
--    themselves, check deposits -- that are neither spending nor income.
--    Appended at the end of the list, mirrored in categoryRules.ts and
--    mobile/lib/categories.ts; the mobile palette colors by index, so
--    existing categories keep their colors.
--
--    This is the category only. is_transfer (which excludes a row from
--    spend/income totals) is unchanged: it is still derived from Plaid's
--    classification and the number of linked accounts, see
--    20260805000000_fix_transfer_flag_and_mortgage_rule.sql.
--
-- 2. Amount conditions, and rules that only catch what nothing else did.
--
--    min_amount / max_amount (inclusive, signed: negative = money out)
--    restrict any rule to transactions in that range.
--
--    match_field = 'uncategorized' marks a fallback rule: it runs after
--    every other rule and the closed-set clamp, and only touches rows that
--    are still 'Miscellaneous'. match_value filters on the raw payee like a
--    payee rule ('' matches every payee). This is what "small incoming
--    payments nothing else explains are transfers" needs: as an ordinary
--    rule it would also catch merchant refunds and paychecks, which a later
--    category rule may or may not happen to overwrite.

alter table public.category_rules
  add column min_amount numeric,
  add column max_amount numeric;

alter table public.category_rules drop constraint category_rules_match_field_check;
alter table public.category_rules
  add constraint category_rules_match_field_check
  check (match_field in ('payee', 'category', 'uncategorized'));

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
    'Insurance', 'Home Services', 'Personal Care',
    'Transfer'
  ];
begin
  update public.transactions
  set category = raw_category, payee = initcap(public.clean_payee(raw_payee))
  where user_id = auth.uid() and raw_category is not null and not manually_edited;

  for r in
    select * from public.category_rules
    where user_id = auth.uid() and enabled and match_field <> 'uncategorized'
    order by priority asc, created_at asc
  loop
    if r.match_field = 'payee' then
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and not manually_edited
        and raw_payee ilike '%' || r.match_value || '%'
        and (r.min_amount is null or amount >= r.min_amount)
        and (r.max_amount is null or amount <= r.max_amount);
    else
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and not manually_edited
        and raw_category ilike '%' || r.match_value || '%'
        and (r.min_amount is null or amount >= r.min_amount)
        and (r.max_amount is null or amount <= r.max_amount);
    end if;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  update public.transactions
  set category = 'Miscellaneous'
  where user_id = auth.uid()
    and not manually_edited
    and not (category = any(allowed_categories));

  -- fallback rules: only what the rules above left uncategorized
  for r in
    select * from public.category_rules
    where user_id = auth.uid() and enabled and match_field = 'uncategorized'
    order by priority asc, created_at asc
  loop
    update public.transactions
    set category = coalesce(r.set_category, category),
        payee = coalesce(r.set_payee, payee)
    where user_id = auth.uid()
      and not manually_edited
      and category = 'Miscellaneous'
      and raw_payee ilike '%' || r.match_value || '%'
      and (r.min_amount is null or amount >= r.min_amount)
      and (r.max_amount is null or amount <= r.max_amount);
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
