-- clean_payee() (supabase/migrations/20260803050000_scrub_transfer_and_reference_junk.sql)
-- has no `set search_path`, unlike apply_category_rules() and every other
-- plpgsql function in this schema, which all pin it. Flagged by the
-- Supabase security advisor (function_search_path_mutable).
--
-- clean_payee() is `security invoker` (not definer) and only calls
-- pg_catalog builtins (regexp_replace, trim), so the practical exploit
-- window here is narrow -- pg_catalog is implicitly searched first unless
-- explicitly repositioned. Still, every call site (apply_category_rules(),
-- and this function itself if ever called directly via RPC) should not
-- depend on that default holding; pinning search_path is the same
-- defense-in-depth already applied everywhere else in this file's sibling
-- functions, at zero behavioral cost since the function body only ever
-- references unqualified builtins.
--
-- CREATE OR REPLACE with the exact same body as
-- 20260803050000_scrub_transfer_and_reference_junk.sql -- only the
-- function's options clause changes.

create or replace function public.clean_payee(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
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

  -- "Online (Realtime) Transfer To/From <name> ..." boilerplate prefix --
  -- strip it so the counterparty name that follows becomes the payee.
  result := regexp_replace(result, '^\s*(Online\s+)?(Realtime\s+)?Transfer\s+(To|From)\s+', '', 'i');

  -- "Transaction#: <code>" / "Reference#: <code>" labeled junk, whether or
  -- not a value follows -- label-based rather than trying to pattern-match
  -- the reference code itself, since those mix digits and letters in ways
  -- the generic digit-run rule below can't reliably catch.
  result := regexp_replace(result, '\yTransaction\s*#:?\s*[a-zA-Z0-9]*', '', 'gi');
  result := regexp_replace(result, '\yReference\s*#:?\s*[a-zA-Z0-9]*', '', 'gi');

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
