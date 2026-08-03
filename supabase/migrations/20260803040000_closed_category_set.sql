-- Enforces a fixed, closed set of top-level categories: after all of a
-- user's category_rules run, anything that still isn't one of these 19
-- values (no rule matched it, or a rule set it to something outside the
-- list) falls back to 'Miscellaneous'. This is a hardcoded universal
-- policy for now (not per-user configurable), same precedent as the
-- title-case/junk-scrub baseline -- if this app ever supports multiple
-- users wanting different taxonomies, this list would need to move into
-- per-user config instead of being baked into the function.

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
  where user_id = auth.uid() and raw_category is not null;

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
        and raw_payee ilike '%' || r.match_value || '%';
    else
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and raw_category ilike '%' || r.match_value || '%';
    end if;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  update public.transactions
  set category = 'Miscellaneous'
  where user_id = auth.uid()
    and not (category = any(allowed_categories));

  return total;
end;
$$;
