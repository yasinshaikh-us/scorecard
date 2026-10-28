-- Payees should be just the vendor's name. clean_payee() already dropped
-- dates, phone numbers, ACH ids and a trailing state, but left behind the
-- rest of the card-descriptor geolocation and masking, e.g.
--
--   "Hmart - Bellevue Bellevue Wa 03/01"   -> was "Hmart - Bellevue Bellevue"
--   "Desi Tadka Indian Gri Xxx-xxxx5592 Il" -> was "Desi Tadka Indian Gri Xxx-"
--   "Wingstop 645 Bellevue Wa 02/22"        -> was "Wingstop 645 Bellevue"
--   "Tst*farzi Cafe Bellevue Wa"            -> was "Tst Cafe Bellevue"
--
-- New steps, in order:
--   * processor prefixes ("TST*", "SQ *", "CKE*", ...) are stripped as a
--     prefix, before the generic "*token" rule -- which used to delete the
--     merchant name that follows the asterisk and keep the prefix
--   * ACH ids with a letter prefix (PPD ID: P942875288)
--   * dates written with spaces ("12 / 28")
--   * a trailing ZIP code / store / terminal number (3+ digits)
--   * trailing "City ST": the city before the state goes too (one word, or
--     two for names like "North Bend" / "Mercer Island"), and the city
--     again if the name already ended in it. For states that are also
--     ordinary words at the end of a name (IN, OR, CO, ...), or when the
--     "city" is a business word (Parking, Inc, Pllc, ...), only the
--     2-letter tail is dropped, as before. Runs before the phone/URL
--     rules, since the city slot often holds a phone number or URL.
--   * URL fragments ("Httpswww.metr")
--   * leftover masked numbers ("Xxx-xxxx3212", "Invxxxxx0207", "X5399"),
--     phone fragments ("425-") and stray asterisks
--   * a connector left dangling by the city removal ("Cuisine Of", "Hmart -")
--
-- Mirrored exactly by cleanPayee() in supabase/functions/_shared/categoryRules.ts;
-- supabase/tests/categoryRulesParity.test.ts runs both on the same inputs.
--
-- payee is derived (raw_payee is never modified), so apply_category_rules()
-- re-derives every row with the new cleaning on its next run.

create or replace function public.clean_payee(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  result text := p;
  m text[];
  city text;
  states constant text :=
    'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  city_first_words constant text :=
    'North|South|East|West|Port|New|San|Santa|Los|Las|Fort|Mount|Mt|Saint|St|Lake|Federal|Mercer|Bainbridge|Gig|Maple|Mill|Mountlake|Battle|Sedro|Walla|Salt|Kansas|Jersey|Daly|Redwood';
  city_last_words constant text :=
    'Island|Harbor|Valley|Terrace|City|Beach|Falls|Springs|Heights|Park|Point|Creek|Bend|Ridge|Hills|Canyon';
  ambiguous_states constant text[] := array['IN', 'OR', 'ME', 'OK', 'HI', 'OH', 'CO', 'DE', 'LA', 'ID'];
  -- words that end a business name, never a city ("Sea Airport Parking WA")
  not_a_city constant text[] := array[
    'parking', 'svcs', 'services', 'service', 'inc', 'inc.', 'llc', 'pllc', 'ltd', 'co', 'corp', 'company',
    'store', 'market', 'mart', 'cafe', 'restaurant', 'bar', 'grill', 'shop', 'center', 'clinic', 'medical',
    'dental', 'licensing', 'online', 'payment', 'fee', 'premium', 'prep', 'pharmacy', 'food', 'foods',
    'coffee', 'pizza', 'burger', 'burgers', 'salon', 'spa', 'studio', 'hotel', 'airlines', 'insurance',
    'bank', 'subscription', 'membership'
  ];
  stripped_city boolean := false;
begin
  -- Note: Postgres's ARE regex flavor uses \y for a word boundary, not
  -- \b (which is NOT a word-boundary synonym here and silently fails to
  -- match anything) -- every boundary below deliberately uses \y.

  -- processor prefixes, then transaction reference codes after '*', and
  -- masked account suffixes like Xx4587 / XXXX1234
  result := regexp_replace(result, '^\s*(TST|SQ|SP|CKE|PAR|PY|DD|BT|IC|LS)\s*\*\s*', '', 'i');
  result := regexp_replace(result, '\*[a-zA-Z0-9]+', '', 'g');
  result := regexp_replace(result, '\yxx+\d+\y', '', 'gi');

  -- "Online (Realtime) Transfer To/From <name> ..." boilerplate prefix --
  -- strip it so the counterparty name that follows becomes the payee.
  result := regexp_replace(result, '^\s*(Online\s+)?(Realtime\s+)?Transfer\s+(To|From)\s+', '', 'i');

  -- "Transaction#: <code>" / "Reference#: <code>" labeled junk, whether or
  -- not a value follows.
  result := regexp_replace(result, '\yTransaction\s*#:?\s*[a-zA-Z0-9]*', '', 'gi');
  result := regexp_replace(result, '\yReference\s*#:?\s*[a-zA-Z0-9]*', '', 'gi');

  result := regexp_replace(result, '\s#(\s|$)', ' ', 'g');

  -- ACH descriptor id numbers (PPD ID: 1142002217, PPD ID: P942875288)
  result := regexp_replace(result, '\y(PPD|WEB|CCD|ARC)\s*ID:?\s*[A-Z]?\d+\y', '', 'gi');

  -- trailing MM/DD or MM/DD/YY(YY) date, with or without spaces
  result := regexp_replace(result, '\s*\d{1,2}\s*/\s*\d{1,2}(\s*/\s*\d{2,4})?\s*$', '');

  -- a phone number at the very end, before the trailing-number rule can
  -- take it apart group by group
  result := regexp_replace(result, '\s*\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*$', '');

  -- trailing ZIP code / store or terminal number
  result := regexp_replace(result, '\s+#?\d{3,}\s*$', '');

  -- trailing "City ST" -- and the city again if the name already ended in
  -- it ("Hmart - Bellevue Bellevue WA"). Runs before the phone/URL rules
  -- because the descriptor's city slot often holds one of those instead
  -- ("Amazon Kids+ 888-802-3080 WA"); stripping them first would make the
  -- name's last word look like the city.
  m := regexp_match(
    result,
    '^(.*\S)\s+((?:' || city_first_words || ')\s+\S+|\S+\s+(?:' || city_last_words || '))\s+(' || states || ')\s*$',
    'i'
  );
  if m is null then
    m := regexp_match(result, '^(.*\S)\s+(\S+)\s+(' || states || ')\s*$', 'i');
  end if;
  if m is not null and not (upper(m[3]) = any(ambiguous_states)) and not (lower(m[2]) = any(not_a_city)) then
    city := m[2];
    result := m[1];
    stripped_city := true;
    if length(result) > length(city) + 1 and lower(right(result, length(city) + 1)) = ' ' || lower(city) then
      result := left(result, length(result) - length(city) - 1);
    end if;
  else
    result := regexp_replace(result, '\s+(' || states || ')\s*$', '', 'i');
  end if;
  result := regexp_replace(result, '\s+#?\d{3,}\s*$', '');

  -- URL fragments
  result := regexp_replace(result, '\yhttps?\S*', '', 'gi');

  -- phone numbers
  result := regexp_replace(result, '\d{3}[-.\s]\d{3}[-.\s]\d{4}', '', 'g');

  -- long standalone reference/transfer numbers (7+ digits)
  result := regexp_replace(result, '\y\d{7,}\y', '', 'g');

  -- masked numbers that survived the rules above ("Xxx-xxxx3212",
  -- "Invxxxxx0207", "X5399"), phone fragments ("425-") and stray asterisks
  result := regexp_replace(result, '\S*xxx\S*', '', 'gi');
  result := regexp_replace(result, '\yX\d{3,}\y', '', 'gi');
  result := regexp_replace(result, '\s\d{3}-(\s|$)', ' ', 'g');
  result := replace(result, '*', '');

  result := regexp_replace(result, '\s+', ' ', 'g');
  result := trim(result);
  -- connector left dangling by the city removal ("Kanishka Cuisine Of",
  -- "Hmart -") -- only then, so a name that really ends in one keeps it
  if stripped_city then
    result := regexp_replace(result, '(\s+(and|of|at|&|-|/))+$', '', 'i');
  end if;
  result := trim(result);

  -- never return an empty string -- fall back to the original if scrubbing
  -- stripped everything (e.g. a payee that was nothing but a phone number)
  if result = '' then
    return p;
  end if;

  return result;
end;
$$;
