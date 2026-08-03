-- Flags transactions that are internal transfers between a user's own
-- linked accounts (Plaid's TRANSFER_IN / TRANSFER_OUT primary category),
-- as opposed to real spending or income.
--
-- Without this, a person with multiple linked accounts who moves money
-- between them (e.g. savings -> checking) gets that movement counted
-- twice by any aggregate over the flattened transaction pool: once as an
-- "expense" on the source account, once as "income" on the destination
-- account. src/logic.js :: filterTransactions excludes is_transfer rows
-- by default so totals reflect money actually leaving/entering the
-- person's overall finances, not shuffling between their own accounts.
--
-- Defaults to false so pre-existing manually-entered rows (which have no
-- Plaid category data to derive this from) are treated as real
-- transactions, matching their current behavior.

alter table public.transactions
  add column is_transfer boolean not null default false;
