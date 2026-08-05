-- api/query.js previously called fetchAllRows() -- the same paginated,
-- every-column, every-row fetch api/transactions.js uses to render the
-- ledger -- purely to compute five scalars for the NL-query system
-- prompt (top-level categories, full Top:Sub category list, the
-- distinct accounts referenced, and the data's min/max date). That
-- meant downloading and JSON-parsing a user's entire transaction
-- history, once per question asked, just to throw away everything but
-- those five values.
--
-- ledger_meta() computes the same values in the database instead, off
-- the (user_id, category, date desc) index added in
-- 20260806020000_replace_transactions_date_category_indexes.sql, and
-- returns a single small row. SECURITY INVOKER + `where user_id =
-- auth.uid()` (no parameters) mirrors apply_category_rules(): always
-- scoped to the caller, never able to target another user's rows.
--
-- distinct_account_ids/has_manual let the caller reproduce the exact
-- same ACCOUNTS list api/query.js built before (every account actually
-- referenced by a transaction, plus "Manual entry" iff at least one
-- row has no plaid_account_id) without re-deriving it from every row --
-- see fetchLedgerMeta()'s comment in api/transactions.js.

create or replace function public.ledger_meta()
returns table (
  categories text[],
  subcategories text[],
  min_date date,
  max_date date,
  distinct_account_ids text[],
  has_manual boolean
)
language sql
security invoker
set search_path = public
as $$
  select
    coalesce(array_agg(distinct split_part(category, ':', 1) order by split_part(category, ':', 1))
             filter (where category is not null), '{}'),
    coalesce(array_agg(distinct category order by category) filter (where category is not null), '{}'),
    min(date),
    max(date),
    coalesce(array_agg(distinct plaid_account_id order by plaid_account_id)
             filter (where plaid_account_id is not null), '{}'),
    coalesce(bool_or(plaid_account_id is null), false)
  from public.transactions
  where user_id = auth.uid();
$$;

grant execute on function public.ledger_meta() to authenticated;
