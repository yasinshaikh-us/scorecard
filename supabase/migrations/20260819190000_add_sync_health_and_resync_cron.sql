-- Two safety nets for the Plaid transaction path, added after it sat
-- broken and unnoticed from 2026-08-15 to 2026-08-19.
--
-- Background: transactions are webhook-only. plaid-webhook is the sole
-- caller of syncItemTransactions, and the Item's cursor only advances
-- after a fully successful run. An oversized historical batch made that
-- run throw, so every subsequent webhook replayed the same failure with
-- the cursor pinned -- a closed loop that could not recover on its own.
-- Meanwhile plaid-balance-refresh kept polling balances hourly on a
-- completely independent path, so the app went on showing a live, correct
-- balance beside a ledger frozen five days in the past. Nothing anywhere
-- said the word "stale".
--
-- 1. A slow resync (every 6h) gives transactions a timed pull, so a lost
--    or failing webhook self-heals instead of freezing the ledger forever.
-- 2. A health check (hourly) watches the resync's own heartbeat and
--    records staleness, so a failure that defeats BOTH paths is still
--    visible rather than silent.
--
-- The two are deliberately coupled: syncItemTransactions stamps
-- plaid_items.updated_at on every successful run, so once the 6h resync
-- exists that column is a heartbeat that ticks whether or not the bank had
-- any activity. Before it, a quiet account and a wedged one looked
-- identical. The 24h threshold is four missed resync cycles, so a single
-- transient failure does not raise a false alarm.

-- ---------------------------------------------------------------------
-- Current sync health, one row per active Item
-- ---------------------------------------------------------------------
-- Current state rather than an append-only log: the useful question is
-- "is ingest working right now", and a row per Item per hour would grow
-- without ever being read. stale_since is the one piece of history worth
-- keeping -- it answers "since when", which is what turns an alert into a
-- diagnosis.
--
-- The FK to plaid_items cascades, so disconnecting a bank cleans up its
-- health row rather than leaving a permanently stale orphan that alerts
-- forever.
create table public.sync_health (
  item_id text primary key references public.plaid_items(item_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_synced_at timestamptz not null,
  is_stale boolean not null,
  stale_since timestamptz,
  checked_at timestamptz not null default now()
);

create index sync_health_user_id_idx on public.sync_health (user_id);

alter table public.sync_health enable row level security;

-- Readable by its owner so the app can surface "your bank feed is behind"
-- later without another migration; never writable from the client, since
-- only the health check itself has any business writing here. The
-- service role bypasses RLS entirely and is what actually populates it.
grant select on public.sync_health to authenticated;

create policy "Users read their own sync health"
  on public.sync_health
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- The health check itself
-- ---------------------------------------------------------------------
-- SECURITY DEFINER and unscoped by design, unlike ledger_meta() and
-- apply_category_rules(): this is an operator-facing sweep across every
-- user's Items, run by pg_cron with no auth.uid() to scope to. Execute is
-- revoked from clients below so it stays that way.
--
-- stale_after is a parameter rather than a literal purely so the SQL
-- tests can drive the boundary directly instead of waiting 24 hours.
create or replace function public.check_plaid_sync_health(
  stale_after interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_count integer;
begin
  insert into public.sync_health as h (item_id, user_id, last_synced_at, is_stale, stale_since, checked_at)
  select
    i.item_id,
    i.user_id,
    i.updated_at,
    i.updated_at < now() - stale_after,
    case when i.updated_at < now() - stale_after then now() end,
    now()
  from public.plaid_items i
  where i.status = 'active'
  on conflict (item_id) do update set
    user_id = excluded.user_id,
    last_synced_at = excluded.last_synced_at,
    is_stale = excluded.is_stale,
    -- Preserve the moment it FIRST went stale across consecutive stale
    -- checks -- overwriting it each hour would report every incident as
    -- one hour old. Cleared on recovery so the next incident starts fresh.
    stale_since = case
      when excluded.is_stale then coalesce(h.stale_since, excluded.stale_since)
      else null
    end,
    checked_at = excluded.checked_at;

  select count(*) into stale_count
  from public.plaid_items
  where status = 'active'
    and updated_at < now() - stale_after;

  -- Surfaced as a warning in postgres_logs, which is the only alerting
  -- channel this project has today. It is a log line, not a notification:
  -- see README.md's "Sync health" section for what still has to be wired
  -- up for this to actually reach a human.
  if stale_count > 0 then
    raise warning 'plaid sync health: % active item(s) have not synced in %', stale_count, stale_after;
  end if;

  return stale_count;
end $$;

revoke all on function public.check_plaid_sync_health(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------
-- Both reuse the Vault secret created by hand for
-- 20260802000100_schedule_plaid_balance_refresh.sql rather than
-- introducing a second one, so this migration needs no manual step.
--
-- Minute offsets keep the three jobs off each other and off the top of
-- the hour: balances at :17, resync at :41, health check at :47 (after
-- the resync it is checking has had time to finish).
select cron.schedule(
  'plaid-transaction-resync',
  '41 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bidorjtgbhuihppsznkc.supabase.co/functions/v1/plaid-transaction-resync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'plaid_balance_refresh_service_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pure SQL, so no Edge Function and no network hop -- one less thing that
-- can fail in the component whose entire job is noticing failure.
select cron.schedule(
  'plaid-sync-health-check',
  '47 * * * *',
  $$ select public.check_plaid_sync_health(); $$
);
