-- Plaid bank-linking integration: dedup columns on transactions, plus new
-- tables for linked items (access tokens), accounts, balances, and
-- auth (account/routing) numbers.
--
-- transactions.plaid_transaction_id lets the sync path upsert without
-- duplicating the pre-existing manually-imported rows (all of which stay
-- source = 'manual' and plaid_transaction_id = NULL). A one-time
-- reconciliation pass after the first live sync will match manual rows
-- against their Plaid-sourced duplicates by date/amount/payee for
-- deletion; see the reconciliation query added alongside this migration.
--
-- plaid_items holds live Plaid access tokens, so it is service-role only:
-- RLS is enabled with zero policies for anon/authenticated, unlike the
-- rest of this app's tables which forward the caller's own JWT and rely
-- on `auth.uid() = user_id` policies. A bank access token is a live
-- credential, not app data, so it never reaches the browser.
-- plaid_auth_numbers (account/routing numbers) gets the same treatment
-- for the same reason.

alter table public.transactions
  add column plaid_transaction_id text unique,
  add column plaid_account_id text,
  add column source text not null default 'manual'
    check (source in ('manual', 'plaid'));

create index transactions_plaid_account_id_idx
  on public.transactions (plaid_account_id);

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  access_token text not null,
  institution_id text,
  institution_name text,
  cursor text,
  status text not null default 'active'
    check (status in ('active', 'error', 'pending_expiration', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plaid_items enable row level security;

create table public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.plaid_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null unique,
  name text,
  mask text,
  type text,
  subtype text,
  created_at timestamptz not null default now()
);

alter table public.plaid_accounts enable row level security;

create policy "Users read their own plaid accounts"
  on public.plaid_accounts
  for select
  to authenticated
  using (auth.uid() = user_id);

create table public.plaid_account_balances (
  account_id text primary key references public.plaid_accounts(account_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  available numeric,
  current numeric,
  iso_currency_code text,
  as_of timestamptz not null default now()
);

alter table public.plaid_account_balances enable row level security;

create policy "Users read their own account balances"
  on public.plaid_account_balances
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Account/routing numbers: never exposed to the client, not even for the
-- owning user. If the UI ever needs to display a masked routing number,
-- that should go through a dedicated server-side endpoint that masks it,
-- not a direct table select with the anon key.
create table public.plaid_auth_numbers (
  account_id text primary key references public.plaid_accounts(account_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_number text not null,
  routing_number text not null,
  wire_routing_number text,
  created_at timestamptz not null default now()
);

alter table public.plaid_auth_numbers enable row level security;
