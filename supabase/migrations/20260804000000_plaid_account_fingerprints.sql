-- Lets a relinked account recognize "I've seen this real bank account
-- before" even after a full disconnect, so the sync path can skip
-- re-inserting transaction history it already has instead of letting
-- Plaid's full historical resync on every fresh Item duplicate it.
--
-- Disconnecting (api/plaid-disconnect.js) intentionally keeps transaction
-- history but cascades away plaid_accounts/plaid_auth_numbers -- by
-- design, so the account stops showing as linked. That means the one
-- thing that could identify "this new account_id from today's relink is
-- the same real account as that old, now-deleted account_id from
-- before" -- the real account/routing number -- is gone by the time a
-- relink happens. This table is a narrow, deliberate exception: it
-- survives disconnect, so that identification is still possible later.
--
-- Stores a one-way hash of account+routing number, never the numbers
-- themselves -- this table is meant to be retained indefinitely (unlike
-- plaid_auth_numbers, which is deleted on disconnect), so it must not
-- hold anything reversible to a real account/routing number. Written
-- once per successfully linked account in api/plaid-exchange.js.
-- `account_id` here is a historical record, not a live foreign key --
-- plaid_accounts.account_id may already be deleted by the time this row
-- is read back (that's the whole point).
create table public.plaid_account_fingerprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  account_id text not null,
  institution_id text,
  created_at timestamptz not null default now()
);

create index plaid_account_fingerprints_user_fingerprint_idx
  on public.plaid_account_fingerprints (user_id, fingerprint);

alter table public.plaid_account_fingerprints enable row level security;
-- No policies for anon/authenticated -- service-role only, same
-- treatment as plaid_items/plaid_auth_numbers (see
-- 20260802000000_add_plaid_integration_schema.sql). This table only ever
-- needs to be written/read by trusted server code doing fingerprint
-- lookups, never directly by a client.

-- Per-account resync boundary: when a relink recognizes a fingerprint
-- match (see api/plaid-exchange.js), this is set to the latest date we
-- already have Plaid-sourced transaction history through for that real
-- account. syncItemTransactions.ts skips inserting any resynced
-- transaction dated on or before this, so Plaid's full historical resync
-- on the fresh Item doesn't duplicate everything that was already in the
-- ledger from before the disconnect.
alter table public.plaid_accounts
  add column resync_after_date date;
