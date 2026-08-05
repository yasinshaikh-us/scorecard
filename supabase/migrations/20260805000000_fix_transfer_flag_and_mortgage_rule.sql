-- Fixes two compounding bugs that made mortgage (and similar) payments
-- disappear from every "how much did I spend" answer after Plaid sync
-- took over from the old manually-imported ledger:
--
-- 1. A pre-existing category_rules row (payee contains "JPMorgan" ->
--    set_category "mortgage") stored the category in lowercase. The
--    closed-category-set safety net at the end of apply_category_rules()
--    compares case-sensitively, so every row that rule touched got reset
--    right back to "Miscellaneous" in the same pass that just set it.
--    This is exactly the class of error the Rules panel's category
--    dropdown (added after this rule was created) now prevents for new
--    rules -- this one-time UPDATE fixes the pre-existing bad value.
--
-- 2. is_transfer was set purely from Plaid's personal_finance_category
--    (TRANSFER_IN/TRANSFER_OUT), which just means "this transaction looks
--    like money moving to another account" -- it says nothing about
--    whether that other account is also tracked by this app. A mortgage
--    payment, alimony payment, or brokerage transfer all get this same
--    Plaid classification. Treating every one of them as an internal,
--    excluded-from-totals transfer only makes sense to avoid double-
--    counting a transfer between two accounts THIS LEDGER tracks -- with
--    fewer than 2 linked plaid_accounts, there's no second tracked
--    account for the money to land in, so nothing here can actually be
--    double-counted. It's real spending (or income) leaving/entering the
--    user's finances and needs to count as such.
--
-- Both fixes are folded into apply_category_rules() rather than a one-off
-- script, so they self-correct going forward through the same "Reapply
-- now" button (and automatic reapply on every rule change) already used
-- for every other retroactive categorization fix -- e.g. if the user
-- links a second account later, the next reapply naturally starts
-- excluding genuine inter-account transfers again.

update public.category_rules
set set_category = 'Mortgage'
where set_category = 'mortgage';

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

  -- See the migration comment above for why this is conditioned on
  -- actually having a second tracked account. Scoped to source='plaid'
  -- only -- older manually-entered rows may have is_transfer set for
  -- their own, unrelated reasons (e.g. a transfer between two accounts
  -- that were both tracked in a pre-Plaid manual ledger) and must not be
  -- reinterpreted under Plaid's classification, which they never had.
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
