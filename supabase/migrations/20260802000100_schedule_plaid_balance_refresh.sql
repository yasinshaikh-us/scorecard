-- Schedules the plaid-balance-refresh Edge Function hourly via pg_cron +
-- pg_net, since Plaid's Balance product has no webhook push (unlike
-- Transactions, which the plaid-webhook function handles reactively).
--
-- The cron job authenticates to the function with the project's
-- service-role key, pulled from Supabase Vault at run time so the actual
-- key value never appears in this migration file or git history. This is
-- a placeholder wiring: the Vault secret referenced below does not exist
-- yet, so the job will 401 against the function until it's created. Run
-- this once, by hand, in the Supabase SQL editor (never commit the real
-- key to a file):
--
--   select vault.create_secret(
--     '<service_role key from Project Settings -> API>',
--     'plaid_balance_refresh_service_key'
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'plaid-balance-refresh',
  '17 * * * *', -- hourly, offset from the top of the hour
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
    body := '{}'::jsonb
  );
  $$
);
