-- The scheduled jobs, as the migrations actually leave them.
--
-- These jobs are the project's only automated recovery and its only
-- staleness signal, and both are invisible when wrong: a double-scheduled
-- job just runs twice, and a job that omits net.http_post's
-- timeout_milliseconds silently gives up after 5 seconds while still
-- looking scheduled. Production had the latter on every HTTP job -- six
-- timed-out calls to one success -- so it is asserted here rather than
-- left to be noticed later.
--
-- Wrapped in a transaction and rolled back by run.sh.

-- ---------------------------------------------------------------------
-- No duplicates
-- ---------------------------------------------------------------------
-- 20260819200000 re-schedules two jobs that 20260802000100 and
-- 20260819190000 already created. Real pg_cron upserts by name; a job
-- scheduled twice would fire twice, which for the resync means two
-- concurrent syncs of the same Item competing for the same cursor.
select test.assert_equals(
  (select count(*)::integer from cron.job),
  4,
  'exactly four cron jobs exist'
);

select test.assert_equals(
  (select count(*)::integer from (select jobname from cron.job group by jobname having count(*) > 1) d),
  0,
  'no job name is scheduled more than once'
);

-- ---------------------------------------------------------------------
-- Every HTTP job sets an explicit timeout
-- ---------------------------------------------------------------------
-- The default is 5000ms. The resync alone has been measured at 27s.
select test.assert_equals(
  (select count(*)::integer
   from cron.job
   where command like '%net.http_post%'
     and command not like '%timeout_milliseconds%'),
  0,
  'every net.http_post cron job passes an explicit timeout_milliseconds'
);

select test.assert(
  (select command from cron.job where jobname = 'plaid-transaction-resync')
    like '%timeout_milliseconds := 120000%',
  'the resync allows 120s, comfortably above its observed 27s runtime'
);

select test.assert(
  (select command from cron.job where jobname = 'plaid-balance-refresh')
    like '%timeout_milliseconds := 30000%',
  'the balance refresh allows 30s, well above its observed ~5s runtime'
);

-- ---------------------------------------------------------------------
-- Schedules survive the re-scheduling
-- ---------------------------------------------------------------------
-- The upsert rewrites schedule as well as command, so a fixed timeout must
-- not quietly change how often a job runs.
select test.assert_equals(
  (select schedule from cron.job where jobname = 'plaid-balance-refresh'),
  '17 * * * *',
  'balances still refresh hourly'
);

select test.assert_equals(
  (select schedule from cron.job where jobname = 'plaid-transaction-resync'),
  '41 */6 * * *',
  'the resync still runs every 6h'
);

select test.assert_equals(
  (select schedule from cron.job where jobname = 'plaid-sync-health-check'),
  '47 * * * *',
  'the health check still runs hourly'
);

-- The health check is pure SQL with no HTTP hop, so it must not be
-- carrying an http_post at all -- that is the property that makes it the
-- one job that cannot fail on a network problem.
select test.assert(
  (select command from cron.job where jobname = 'plaid-sync-health-check')
    not like '%http_post%',
  'the health check calls the function directly, with no HTTP hop'
);
