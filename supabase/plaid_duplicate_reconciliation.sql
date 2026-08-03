-- Run this by hand (Supabase SQL editor) after the first live Plaid sync
-- has landed, to find manually-imported rows that are now duplicated by a
-- synced Plaid row for the same account. This is a review query, not a
-- migration — nothing here runs automatically, and the final DELETE is
-- commented out on purpose. Payee text often differs between the manual
-- import and Plaid's own naming (e.g. "Amazon" vs "AMAZON.COM*1AB23"), so
-- match on date + amount (exact, since these are the two fields least
-- likely to have been transcribed differently) and eyeball payee/category
-- yourself before deleting anything.

select
  manual.id as manual_id,
  manual.date,
  manual.payee as manual_payee,
  manual.amount,
  plaid.id as plaid_id,
  plaid.payee as plaid_payee,
  plaid.plaid_transaction_id
from public.transactions manual
join public.transactions plaid
  on plaid.source = 'plaid'
  and plaid.user_id = manual.user_id
  and plaid.date = manual.date
  and plaid.amount = manual.amount
where manual.source = 'manual'
order by manual.date desc;

-- Once you've confirmed a batch of matches above are genuine duplicates
-- (not two legitimate same-day, same-amount transactions), delete the
-- manual-import side by id:
--
-- delete from public.transactions where id in (<manual_id, manual_id, ...>);
