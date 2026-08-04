-- Backs the "edit an expense row directly" feature: a payee/category edit
-- made straight from the UI (as opposed to through a category_rules entry)
-- needs to survive apply_category_rules() running again later -- which it
-- does, automatically, after every add/edit/delete/toggle of any rule, not
-- just the one that (maybe) matches this row. Without this flag,
-- apply_category_rules()'s reset step (category = raw_category, payee =
-- initcap(clean_payee(raw_payee))) would silently wipe a direct edit the
-- very next time the user touched any rule at all.

alter table public.transactions
  add column manually_edited boolean not null default false;

comment on column public.transactions.manually_edited is
  'True once payee/category was set directly via the UI rather than by category_rules. apply_category_rules() skips these rows entirely so a direct edit is not silently reverted by an unrelated rule change.';

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
  allowed_categories text[] := array[
    'Income', 'Mortgage', 'Investments', 'Rent', 'Alimony', 'Taxes', 'Miscellaneous',
    'Dining', 'Shopping', 'Utilities', 'Groceries', 'Transport', 'Education', 'Health',
    'Cash', 'Travel', 'Software', 'Entertainment', 'Fees'
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

  return total;
end;
$$;
