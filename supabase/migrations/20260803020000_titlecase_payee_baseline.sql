-- Payee display formatting is a universal default ("no ALL CAPS, ever"),
-- not a per-user match rule -- it applies to every transaction regardless
-- of content, which the "if contains X" rules engine can't express. Baked
-- into apply_category_rules()'s reset step instead of a category_rules
-- row: title-case the raw payee as the baseline everyone starts from,
-- before user-defined rules layer their own overrides on top.

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
begin
  update public.transactions
  set category = raw_category, payee = initcap(raw_payee)
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

  return total;
end;
$$;
