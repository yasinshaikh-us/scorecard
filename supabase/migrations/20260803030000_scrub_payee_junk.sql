-- Bank/card statement descriptors are frequently full of junk beyond just
-- casing: masked account suffixes (Xx4587), transaction reference codes
-- (*168944d1), phone numbers, ACH PPD/WEB ID numbers, long reference
-- digit runs, trailing city/state, and trailing MM/DD dates. Strip all of
-- that before title-casing, as part of the same universal baseline
-- apply_category_rules() starts every payee from -- heuristic-based, not
-- perfect for every descriptor format, but a big improvement over raw
-- bank text.

create or replace function public.clean_payee(p text)
returns text
language plpgsql
immutable
as $$
declare
  result text := p;
begin
  -- transaction reference codes after '*', and masked account suffixes
  -- like Xx4587 / XXXX1234
  --
  -- Note: Postgres's ARE regex flavor uses \y for a word boundary, not
  -- \b (which is NOT a word-boundary synonym here and silently fails to
  -- match anything) -- every boundary below deliberately uses \y.
  result := regexp_replace(result, '\*[a-zA-Z0-9]+', '', 'g');
  result := regexp_replace(result, '\yxx+\d+\y', '', 'gi');
  result := regexp_replace(result, '\s#(\s|$)', ' ', 'g');

  -- ACH descriptor id numbers (PPD ID: 1142002217, WEB ID: ...)
  result := regexp_replace(result, '\y(PPD|WEB|CCD|ARC)\s*ID:?\s*\d+\y', '', 'gi');

  -- phone numbers
  result := regexp_replace(result, '\d{3}[-.\s]\d{3}[-.\s]\d{4}', '', 'g');

  -- long standalone reference/transfer numbers (7+ digits)
  result := regexp_replace(result, '\y\d{7,}\y', '', 'g');

  -- trailing MM/DD or MM/DD/YY(YY) date
  result := regexp_replace(result, '\s*\d{1,2}/\d{1,2}(/\d{2,4})?\s*$', '', 'g');

  -- trailing US state abbreviation
  result := regexp_replace(
    result,
    '\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$',
    '', 'gi'
  );

  result := regexp_replace(result, '\s+', ' ', 'g');
  result := trim(result);

  -- never return an empty string -- fall back to the original if scrubbing
  -- stripped everything (e.g. a payee that was nothing but a phone number)
  if result = '' then
    return p;
  end if;

  return result;
end;
$$;

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

  return total;
end;
$$;
