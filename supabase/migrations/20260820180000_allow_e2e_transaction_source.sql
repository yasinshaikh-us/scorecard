-- Let a transaction declare itself as Stage 2 test data.
--
-- The Detox suite seeds a ledger onto synthetic-monitor@scorecard.test
-- before every run and deletes it afterwards (mobile/e2e/seedLedger.js).
-- That cleanup wants a filter that can only ever match rows the suite
-- itself wrote -- the alternative was deleting every 'manual' row on the
-- account, which would also take anything a human had entered there by
-- hand.
--
-- 'e2e' is inert to the rest of the system: the sync and Plaid-link
-- paths only ever filter on source = 'plaid', and nothing reads the
-- column otherwise.
--
-- Applied to the live project (bidorjtgbhuihppsznkc) via the Supabase MCP
-- `apply_migration` tool; this file mirrors that change for
-- version-control history and local/CLI parity, matching the convention
-- the earlier migrations in this directory record.

alter table public.transactions
  drop constraint transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check
  check (source = any (array['manual'::text, 'plaid'::text, 'e2e'::text]));
