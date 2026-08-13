-- Supabase platform primitives, recreated on stock Postgres.
--
-- The migrations in supabase/migrations/ are written against a Supabase
-- project, so they assume things the Supabase platform provides rather
-- than anything in this repo: the `auth` schema and `auth.uid()`, the
-- three built-in roles, and (in two migrations) the pg_cron/pg_net/vault
-- extensions. Stock Postgres has none of that, so this file supplies just
-- enough of it for the migrations to apply and for RLS to behave the way
-- it does in production.
--
-- WHAT THIS DOES AND DOESN'T PROVE
--
-- The policies, GRANTs and functions under test are the REAL ones, applied
-- straight from supabase/migrations/. This file provides only the
-- platform's primitives, and the one that matters -- auth.uid() -- is
-- reproduced exactly as Supabase defines it: read the `sub` claim out of
-- the request-scoped GUC that PostgREST sets per request. Setting that GUC
-- and switching role is precisely what PostgREST does when it handles an
-- authenticated request, so "a policy lets this user see this row" here
-- means the same thing it means in production.
--
-- What it does NOT cover: JWT verification itself (Supabase's gateway does
-- that before PostgREST ever sets the claim), the Edge Function layer, or
-- pg_cron actually firing. Those are outside the schema, which is what
-- these tests are about.

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
-- Supabase ships these three. `anon` and `authenticated` are what
-- PostgREST switches into for unauthenticated and signed-in requests
-- respectively; `service_role` is the privileged one used by Edge
-- Functions, and it bypasses RLS.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- bypassrls mirrors Supabase: service_role is not subject to RLS.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants the client roles blanket table privileges on `public`
-- and sets default privileges so newly created tables inherit them. RLS,
-- not the GRANT, is what actually restricts rows -- that separation is the
-- entire security model here, and reproducing it is essential: without
-- these, a policy test would fail with "permission denied for table" and
-- look like the policy working when it is really the grant missing.
--
-- These run BEFORE the migrations, matching production ordering, so
-- 20260802010000_lock_down_plaid_items_columns.sql still has something to
-- revoke when it narrows plaid_items down to four readable columns.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Migrations create most tables AFTER this file runs, so blanket grants
-- above wouldn't reach them -- default privileges are what carry the same
-- grants onto anything created later, exactly as on a real project.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------
create schema if not exists auth;

-- Only the columns this repo's migrations actually reference. Several
-- tables carry `user_id uuid references auth.users(id)`, so the table and
-- its primary key have to exist for those migrations to apply.
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

-- Supabase's own definition. PostgREST sets `request.jwt.claims` (and,
-- historically, `request.jwt.claim.sub`) as a request-local GUC; auth.uid()
-- just reads the `sub` out of it. Reproduced rather than approximated,
-- because every RLS policy in this repo is written in terms of it.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Pre-migration baseline: public.transactions
-- ---------------------------------------------------------------------
-- NOTE: this is a gap in the repo, not a choice made here.
--
-- supabase/migrations/ is NOT self-contained. The oldest migration
-- (20260730231500_add_user_id_and_rls_to_transactions.sql) does
-- `alter table public.transactions add column user_id ...` -- it assumes
-- the table already exists, because it was created by hand in the Supabase
-- dashboard before migrations were introduced. Applying the migration
-- directory to an empty database therefore fails on the very first file,
-- which means the schema cannot be rebuilt from this repo alone (a new
-- environment, a restore drill, or a Supabase branch would all hit this).
--
-- Reconstructed here so the tests can run. The columns are the five that
-- SCHEMA.md documents as pre-existing; every other column on this table
-- arrives via a migration and is deliberately NOT created here, so the
-- migrations still have to do their real work.
--
-- The proper fix is a baseline migration in supabase/migrations/. That
-- would rewrite migration history against the live project, so it is left
-- as a flagged decision rather than done silently.
create table if not exists public.transactions (
  id bigint generated by default as identity primary key,
  date date not null,
  payee text not null,
  category text not null,
  amount numeric not null
);

-- RLS was already on (with no policies, i.e. service-role only) before the
-- first migration ran; the first migration adds the policy, not the enable.
alter table public.transactions enable row level security;

-- Two pre-migration indexes, recreated for the same reason as the table:
-- 20260806020000_replace_transactions_date_category_indexes.sql DROPs them
-- by name, so without them that migration fails with
-- `index "transactions_date_idx" does not exist`.
create index if not exists transactions_date_idx on public.transactions (date desc);
create index if not exists transactions_category_idx on public.transactions (category);

-- ---------------------------------------------------------------------
-- Extension stubs (pg_cron / pg_net / vault)
-- ---------------------------------------------------------------------
-- Two migrations schedule the hourly balance refresh. That's platform
-- wiring, not schema logic, and none of it is what these tests check --
-- but the migrations still have to APPLY cleanly, so the handful of
-- functions they call exist here as no-ops. run.sh additionally strips the
-- `create extension` lines, which stock Postgres cannot satisfy at all.
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;

create table if not exists cron.job (
  jobid bigserial primary key,
  jobname text,
  schedule text,
  command text
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  returning jobid
$$;

create or replace function cron.unschedule(job_name text)
returns boolean
language sql
as $$
  delete from cron.job where jobname = job_name returning true
$$;

create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}')
returns bigint
language sql
as $$ select 0::bigint $$;

create or replace view vault.decrypted_secrets as
  select null::text as name, null::text as decrypted_secret where false;

-- ---------------------------------------------------------------------
-- Test assertion helpers
-- ---------------------------------------------------------------------
-- Deliberately not pgTAP: it isn't available in stock Postgres images
-- either, and these tests need exactly two primitives. Every helper raises
-- an exception on failure, and the runner uses ON_ERROR_STOP=1, so a
-- failed assertion fails the job with the message attached.
create schema if not exists test;

-- The assertion helpers are called from inside `set local role
-- authenticated` / `anon` blocks, so every role has to be able to reach
-- them. They read no application data themselves.
grant usage on schema test to public;

create or replace function test.assert(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end $$;

create or replace function test.assert_equals(actual anyelement, expected anyelement, message text)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', message, expected, actual;
  end if;
end $$;

-- Switches the session into an authenticated request for a given user,
-- exactly as PostgREST does: set the JWT claims GUC, then assume the
-- `authenticated` role. Everything after this call is subject to RLS as
-- that user.
create or replace function test.become(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- An unauthenticated visitor: no claims at all, `anon` role.
create or replace function test.become_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
