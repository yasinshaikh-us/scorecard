-- Marks a transaction the bank has authorized but not yet posted.
--
-- Plaid's /transactions/sync has always delivered pending transactions in
-- its `added` stream -- there is no flag to exclude them, and this app
-- never filtered them out -- so they were already landing in the ledger.
-- What was missing is that nothing recorded WHICH rows they were, so the
-- app drew an authorized-but-unsettled charge identically to a settled
-- one. That is the difference between a figure you can reconcile against
-- your statement and one you can't.
--
-- It also explains the balance the Home screen shows. Plaid reports two
-- numbers per account (plaid_account_balances.current and .available);
-- `current` only moves once a charge posts, roughly a business day after
-- it is authorized, while `available` moves immediately. Observed on the
-- live account while writing this: current 63757.03 against available
-- 63577.55, a $179.48 spread that is precisely the pending activity.
-- AccountBalances.tsx now leads with `available` and names that spread as
-- pending, which is only legible because the ledger can now say which
-- rows are pending.
--
-- Defaults to false, which is right for both backfill cases: manual rows
-- were never pending, and an already-synced Plaid row is assumed settled
-- until Plaid says otherwise. Rows that are genuinely pending right now
-- self-correct within a day or so -- Plaid re-reports every one of them
-- (as `modified`, or as `removed` plus a fresh posted row) the moment it
-- settles, and that re-report writes the real value.

alter table public.transactions
  add column pending boolean not null default false;

-- Recent-activity lists and the pending-total arithmetic both filter on
-- (user_id, pending) over a small, hot slice of the table. Partial, since
-- `false` is the overwhelming majority and indexing it buys nothing --
-- only the pending rows are ever looked up by this flag.
create index transactions_user_pending_idx
  on public.transactions (user_id)
  where pending;
