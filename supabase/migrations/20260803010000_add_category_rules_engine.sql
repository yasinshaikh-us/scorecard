-- Category rules engine: user-defined "if payee/category contains X, set
-- category/payee to Y" rules, applied both going forward (in the Plaid
-- sync path) and retroactively to existing history (via
-- apply_category_rules()) -- the same mental model as an email inbox
-- filter with "apply to existing" checked.
--
-- Retroactive application only works cleanly if the *original* value is
-- always available to re-match against, independent of how many times
-- rules have already been applied -- otherwise re-running rules matches
-- against an already-transformed value instead of the source data, and
-- results become order-dependent. raw_payee/raw_category exist for
-- exactly that reason: they're never touched by the rules engine, only
-- ever set once from the transaction's original source (Plaid's fields,
-- or the pre-existing manually-imported value).

alter table public.transactions
  add column raw_payee text,
  add column raw_category text;

update public.transactions
set raw_payee = payee, raw_category = category
where raw_payee is null;

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  priority integer not null default 100,
  match_field text not null check (match_field in ('payee', 'category')),
  match_value text not null,
  set_category text,
  set_payee text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.category_rules enable row level security;

create policy "Users manage their own category rules"
  on public.category_rules
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Resets every transaction to its raw values, then re-applies enabled
-- rules in ascending priority order (ties broken by creation order) --
-- later-priority matches overwrite earlier ones for the same row, so a
-- higher-priority number "wins" if more than one rule matches. No
-- parameters: always operates on auth.uid(), so a caller can never target
-- another user's rows through this function.
create or replace function public.apply_category_rules()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  affected integer;
  total integer := 0;
begin
  update public.transactions
  set category = raw_category, payee = raw_payee
  where user_id = auth.uid() and raw_category is not null;

  for r in
    select * from public.category_rules
    where user_id = auth.uid() and enabled
    order by priority asc, created_at asc
  loop
    if r.match_field = 'payee' then
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and raw_payee ilike '%' || r.match_value || '%';
    else
      update public.transactions
      set category = coalesce(r.set_category, category),
          payee = coalesce(r.set_payee, payee)
      where user_id = auth.uid()
        and raw_category ilike '%' || r.match_value || '%';
    end if;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  return total;
end;
$$;

grant execute on function public.apply_category_rules() to authenticated;
