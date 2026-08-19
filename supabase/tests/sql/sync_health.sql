-- check_plaid_sync_health() and the RLS on the table it writes.
--
-- This function is the last line of defence: it is what notices that the
-- webhook path AND the 6h resync have both stopped working. A bug here is
-- invisible by construction -- it fails by staying quiet, which is
-- indistinguishable from everything being fine. That is precisely the
-- failure mode that let the real outage run for five days, so the
-- boundary, the latch, and the recovery path are all asserted directly.
--
-- Wrapped in a transaction and rolled back by run.sh.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid');

-- Alice's Item synced 48h ago (stale), Bob's 1h ago (fresh).
insert into public.plaid_items (id, user_id, item_id, access_token, institution_id, institution_name, cursor, status, updated_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'item-alice', 'access-ALICE', 'ins_1', 'Alice Bank', 'cursor-alice', 'active', now() - interval '48 hours'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'item-bob', 'access-BOB', 'ins_2', 'Bob Bank', 'cursor-bob', 'active', now() - interval '1 hour');

-- ---------------------------------------------------------------------
-- Detection
-- ---------------------------------------------------------------------
select test.assert_equals(
  public.check_plaid_sync_health(),
  1,
  'one of the two active items has not synced in 24h'
);

select test.assert_equals(
  (select is_stale from public.sync_health where item_id = 'item-alice'),
  true,
  'the item last synced 48h ago is stale'
);

select test.assert_equals(
  (select is_stale from public.sync_health where item_id = 'item-bob'),
  false,
  'the item last synced 1h ago is not stale'
);

-- Both active items get a row, not just the failing one: "checked and
-- healthy" and "never checked" have to be distinguishable, or a health
-- check that silently stopped running would look exactly like good news.
select test.assert_equals(
  (select count(*)::integer from public.sync_health),
  2,
  'every active item is recorded, healthy or not'
);

-- ---------------------------------------------------------------------
-- The threshold is a real boundary, not always-true
-- ---------------------------------------------------------------------
select test.assert_equals(
  public.check_plaid_sync_health(interval '72 hours'),
  0,
  'nothing is stale against a 72h threshold'
);

select test.assert_equals(
  (select is_stale from public.sync_health where item_id = 'item-alice'),
  false,
  'recovery clears the stale flag rather than latching it forever'
);

select test.assert(
  (select stale_since from public.sync_health where item_id = 'item-alice') is null,
  'stale_since is cleared once the item is healthy again'
);

-- ---------------------------------------------------------------------
-- stale_since answers "since when", so it must not creep forward
-- ---------------------------------------------------------------------
select public.check_plaid_sync_health();

-- The earlier observation is planted rather than taken from a first call:
-- now() is the TRANSACTION timestamp, so two calls inside this test would
-- stamp byte-identical values and the assertion would hold even if the
-- coalesce were replaced by a blind overwrite. Planting a distinct value
-- is what makes this test the latch instead of the clock.
update public.sync_health
  set stale_since = timestamptz '2026-01-01 00:00:00+00'
  where item_id = 'item-alice';

select public.check_plaid_sync_health();

select test.assert_equals(
  (select stale_since from public.sync_health where item_id = 'item-alice'),
  timestamptz '2026-01-01 00:00:00+00',
  'stale_since keeps the first observation across repeated checks'
);

-- ---------------------------------------------------------------------
-- Only active items are watched
-- ---------------------------------------------------------------------
-- An Item whose access the user revoked is not expected to sync, so
-- alerting on it would be pure noise -- and noise is what gets an alert
-- ignored. Same for 'error' and 'pending_expiration': those have their own
-- re-auth path in the app and are not a silent-ingest-failure signal.
update public.plaid_items set status = 'revoked' where item_id = 'item-alice';

select test.assert_equals(
  public.check_plaid_sync_health(),
  0,
  'an item that is no longer active is not reported stale'
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select test.become('11111111-1111-1111-1111-111111111111');

select test.assert_equals(
  (select count(*)::integer from public.sync_health),
  1,
  'a user sees only their own sync health row'
);

select test.assert_equals(
  (select item_id from public.sync_health),
  'item-alice',
  'and it is their own item'
);

reset role;
select test.become('22222222-2222-2222-2222-222222222222');

select test.assert_equals(
  (select count(*)::integer from public.sync_health where item_id = 'item-alice'),
  0,
  'another user''s sync health row is not visible'
);

reset role;

-- The health check sweeps every user's items, so a client being able to
-- run it would be a cross-tenant read dressed up as a maintenance call.
select test.become('11111111-1111-1111-1111-111111111111');

do $$
begin
  perform public.check_plaid_sync_health();
  raise exception 'ASSERTION FAILED: authenticated should not be able to run check_plaid_sync_health()';
exception
  when insufficient_privilege then
    null;
end $$;

reset role;
