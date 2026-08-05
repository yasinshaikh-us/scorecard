-- 90-day retention policy for a disconnected bank account's transaction
-- history. Previously, disconnecting (api/plaid-disconnect.js) deleted the
-- live plaid_items/plaid_accounts/plaid_auth_numbers rows but deliberately
-- left every already-synced transaction in place forever -- there was no
-- code path that ever removed it. This adds one: once a real account has
-- stayed disconnected for more than 90 days (i.e. it hasn't been relinked
-- in the meantime), its transactions -- and the fingerprint that would
-- otherwise let a future relink recognize it -- are purged for good.
--
-- Tracking table: api/plaid-disconnect.js writes one row here per
-- account_id at disconnect time, before the plaid_items delete cascades
-- plaid_accounts away. This is what lets the cron job below know *when*
-- an account was disconnected, since that information doesn't survive
-- anywhere else once plaid_accounts is gone.
create table public.plaid_disconnected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null unique,
  -- Mirrors plaid_account_fingerprints.fingerprint for the same account_id
  -- at the moment of disconnect, if one exists (Auth wasn't available for
  -- every institution). Lets the purge job recognize "this real account
  -- was relinked since disconnecting" and skip purging its still-relevant
  -- history, instead of just going by account_id (which Plaid never
  -- reuses, so it alone can't tell a stale disconnect from an active
  -- relink under a new account_id).
  fingerprint text,
  disconnected_at timestamptz not null default now()
);

create index plaid_disconnected_accounts_disconnected_at_idx
  on public.plaid_disconnected_accounts (disconnected_at);

alter table public.plaid_disconnected_accounts enable row level security;
-- No policies for anon/authenticated -- service-role only, same treatment
-- as plaid_items/plaid_auth_numbers. Purely internal bookkeeping for the
-- purge job below; no client ever needs to read or write this directly.

-- Deletes transactions (and the fingerprint) for any tracked account that
-- has been disconnected for more than 90 days and never relinked. Runs as
-- the function owner (postgres, via the migration), not the caller, since
-- this is a background maintenance job with no user session to scope
-- auth.uid() to -- it has to operate across every user's data. Execute is
-- revoked from anon/authenticated below so it can only run via the cron
-- job scheduled at the bottom of this file (or manually, by an admin).
create or replace function public.purge_stale_disconnected_transactions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  purged_accounts integer := 0;
  relinked boolean;
begin
  for r in
    select id, account_id, fingerprint
    from public.plaid_disconnected_accounts
    where disconnected_at < now() - interval '90 days'
  loop
    relinked := false;

    if r.fingerprint is not null then
      -- Same real account showed up again under a (necessarily different)
      -- account_id that's still actively linked -- this disconnect event
      -- is stale/moot, not "gone for 90+ days" in any way that matters.
      select exists (
        select 1
        from public.plaid_account_fingerprints f
        join public.plaid_accounts a on a.account_id = f.account_id
        where f.fingerprint = r.fingerprint
      ) into relinked;
    end if;

    if not relinked then
      delete from public.transactions
      where plaid_account_id = r.account_id
        and source = 'plaid';

      delete from public.plaid_account_fingerprints
      where account_id = r.account_id;

      purged_accounts := purged_accounts + 1;
    end if;

    delete from public.plaid_disconnected_accounts where id = r.id;
  end loop;

  return purged_accounts;
end;
$$;

revoke execute on function public.purge_stale_disconnected_transactions() from public;

create extension if not exists pg_cron;

select cron.schedule(
  'purge-stale-disconnected-transactions',
  '0 3 * * *', -- daily, 3am UTC
  $$select public.purge_stale_disconnected_transactions();$$
);
