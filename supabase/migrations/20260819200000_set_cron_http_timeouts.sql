-- Give both HTTP cron jobs an explicit pg_net timeout.
--
-- net.http_post's timeout_milliseconds defaults to 5000, and neither job
-- was passing it. Evidence from production, over pg_net's ~6h response
-- retention: six timed-out calls to one recorded success.
--
--   select status_code, error_msg is not null from net._http_response;
--   -- status_code null, timed out true  -> 6
--   -- status_code 200,  timed out false -> 1
--
-- plaid-balance-refresh straddles the limit (observed 4.4s-5.5s per run,
-- so it times out on the slower half). plaid-transaction-resync is not
-- close: a real resync of a five-day backlog took 27 seconds, five times
-- the default.
--
-- The work itself was still completing -- the Edge Function runs to the
-- end and returns 200 even after pg_net has hung up, which is why balances
-- stayed current and why the resync that recovered the Aug 15-19 outage
-- landed all 16 transactions despite its caller reporting a timeout. So
-- this is not data loss. What it costs is the signal: net._http_response
-- records a timeout instead of the function's status code and body, so the
-- one place that would say "the scheduled resync is failing" says
-- "timeout" on every single run, healthy or not. A monitor that always
-- reads the same is not a monitor -- and these two jobs exist precisely to
-- make ingest failures visible.
--
-- It also stops the jobs depending on undocumented runtime behaviour.
-- "The isolate keeps running after the client disconnects" is not a
-- contract Supabase offers; the 27-second resync only survives because of
-- it. Ask for the time the work actually takes instead.
--
-- 120s for the resync (a first sync on a fresh Item pages through far more
-- than five days of history), 30s for the balance refresh (6x its observed
-- worst case). Both stay under the Edge Function wall-clock limit, so the
-- function is still the thing that bounds a runaway, not pg_net.
--
-- cron.schedule upserts by job name, so these replace the existing jobs
-- rather than adding duplicates.

select cron.schedule(
  'plaid-balance-refresh',
  '17 * * * *',
  $$
  select net.http_post(
    url := 'https://bidorjtgbhuihppsznkc.supabase.co/functions/v1/plaid-balance-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'plaid_balance_refresh_service_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

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
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
