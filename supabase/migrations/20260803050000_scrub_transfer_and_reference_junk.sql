-- clean_payee() missed a whole descriptor family: bank-initiated transfer
-- lines like "Online Realtime Transfer To Sagira Vora 3699 Transaction#:
-- 30255370026 Reference#: 9255370026RX 08/03". Two gaps:
--   1. Nothing stripped the "Online (Realtime) Transfer To/From" boilerplate
--      prefix, so it survived ahead of the actual counterparty name.
--   2. The "long digit run" rule only matched *pure* digit runs bounded by
--      \y -- "Reference#: 9255370026RX" has letters glued directly onto the
--      digits (no boundary before "RX"), so it never matched, and
--      "Transaction#:" was left dangling once its own digit run (matching
--      \d{7,} on its own) got stripped out from under it.
-- Fixing this with explicit label-based stripping (Transaction#/Reference#
-- plus whatever alphanumeric code follows) is more robust than trying to
-- widen the digit-run regex to guess at mixed alnum reference codes
-- elsewhere, which risks stripping real payee text that happens to end in
-- a couple of letters.

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
