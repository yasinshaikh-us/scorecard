# fa/thm — personal ledger

A native iOS/Android app over your transaction history. Ask a question in
plain English; a Supabase Edge Function forwards the question (never your
transaction data) to Claude, which returns a small JSON filter/chart spec;
the app applies that spec locally and renders the chart + list.

This is a **mobile-only** project. The app is the Expo/React Native client
in [`mobile/`](mobile/) — see [`mobile/README.md`](mobile/README.md) for
running it, building it, and its three-stage testing pyramid. This root
directory holds the shared backend it talks to, plus the docs.

> A React web app used to live at this repo root, deployed on Vercel, and
> was the original client. It has been removed — the mobile app it was
> always meant to be replaced by now covers the same functionality. If you
> need that code, it's in this repo's git history.

Your transaction data lives in a Supabase Postgres table, read through a
Supabase Edge Function (`transactions`) that forwards your signed-in Google
session's own access token to Supabase. Row Level Security on the table
restricts every request to that user's own rows (`auth.uid() = user_id`) —
Postgres enforces the isolation, not app code.

The backend is entirely on Supabase — Postgres, Auth, and every
server-side function (both the ones the app calls directly and the Plaid
webhook/cron jobs) live on one platform. There is no other hosting
provider in the picture.

See [`SCHEMA.md`](SCHEMA.md) for the full database schema — every table,
column, constraint, and RLS policy, including the Plaid bank-sync tables.

## Getting the app running

Everything about the client — install, run, dev client, builds, tests —
is in [`mobile/README.md`](mobile/README.md):

```bash
cd mobile
npm install
cp .env.example .env    # your Supabase project URL + anon key
```

The rest of this file is about the backend those commands talk to.

## 1. Get your keys

This needs:

- An **Anthropic API key**, separate from any claude.ai subscription
  (Pro/Max don't include API access). Sign up at
  [console.anthropic.com](https://console.anthropic.com), add billing, and
  create a key.
- A **Supabase project** with a `transactions` table (`date`, `payee`,
  `category`, `amount`, `user_id`) — see "Updating your transaction data"
  below. From **Project Settings → API Keys**, grab the **Project URL** and
  the **anon/publishable key** (safe to expose to the client by design).
- **Google enabled as a sign-in provider** on that Supabase project
  (Authentication → Providers → Google), with a Client ID/Secret from a
  Google Cloud OAuth client whose authorized redirect URI is
  `<Project URL>/auth/v1/callback`. This is a one-time dashboard step, not
  an env var. Supabase Auth's **Redirect URLs** allowlist also needs
  `fathom://*` for the app's deep-link callback — see
  [`mobile/README.md`](mobile/README.md#auth).

## 2. Local backend development

```bash
supabase functions serve   # needs the Supabase CLI
```

`supabase functions serve` needs its own env vars (`PLAID_CLIENT_ID`,
`PLAID_SECRET`, `PLAID_ENV`, `ANTHROPIC_API_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`) — pass an env file with `--env-file`, or
`supabase secrets set` them for a linked project. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are provided automatically. See
[`.env.example`](.env.example).

## 3. Deploy the Edge Functions

**This is automatic.** `.github/workflows/ci.yml`'s `deploy-edge-functions`
job deploys everything in `supabase/functions/` on every push to `main`,
once both test jobs pass. It needs a **`SUPABASE_ACCESS_TOKEN` repo
secret** (Supabase dashboard → Account → Access Tokens → generate, then
add it under GitHub → Settings → Secrets and variables → Actions).

> **This job was added after discovering the repo and the live project had
> silently diverged.** Nothing deployed the Edge Functions before it:
> backend changes merged to `main` and never reached production, leaving
> the deployed `test-plaid-link` on version 3, missing every backend
> change made since — including a `categoryRules.ts` fix that the
> TypeScript↔SQL parity test asserts is present. Green tests against code
> that isn't the code running in production are a worse signal than no
> tests at all.

`plaid-webhook` and `test-login` deploy with `--no-verify-jwt`; every
other function keeps `verify_jwt` on. The workflow spells that out in two
explicit lists rather than hiding it in a config file, because getting it
wrong is silent and serious in both directions — verification *on* for
`plaid-webhook` would 401 every real Plaid webhook (transactions would
stop syncing, with nothing surfacing it), and *off* for any other
function would expose an authenticated endpoint. A guard step fails the
job if a function directory appears in neither list, so a newly added
function can't quietly go undeployed.

To deploy by hand instead (e.g. before the secret exists):

```bash
supabase functions deploy plaid-webhook test-login --no-verify-jwt --project-ref <ref>
supabase functions deploy plaid-balance-refresh plaid-disconnect plaid-exchange \
  plaid-link-token plaid-transaction-resync query test-plaid-link transactions \
  --project-ref <ref>
```

Set these as Edge Function secrets first (Project Settings → Edge Functions
→ Secrets, or `supabase secrets set`) — `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected, no
action needed for those three:

- `ANTHROPIC_API_KEY`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`

Every function in that second `deploy` list expects `verify_jwt` enabled
(the platform default) — the gateway rejects any request without a valid
Supabase JWT on `Authorization` before the function code runs. The two in
the first list are the exceptions: `plaid-webhook`, since Plaid calls it
directly rather than a signed-in user (it authenticates the caller itself,
via `verifyPlaidWebhook`), and `test-login`, which mints a session from a
shared secret. Note that `plaid-balance-refresh` and
`plaid-transaction-resync` are *not* exceptions despite being called by
`pg_cron` rather than a user: the service-role key is itself a valid
Supabase JWT, so the gateway accepts it and each function then checks it is
specifically that key.

Two of the deployed functions exist purely to support the app's automated
testing (see `mobile/README.md`'s "Test login" / "Test Plaid Link"
sections) and aren't needed to run the app normally: `test-login` (which
is why it's in the `--no-verify-jwt` group above — it authenticates via a
shared secret, not a session) and `test-plaid-link` (which keeps
`verify_jwt` enabled, since it needs a real signed-in user). `test-login`
needs its own Edge Function secret (`TEST_LOGIN_SECRET`) set before it'll do
anything. `test-plaid-link` needs three: `TEST_PLAID_LINK_SECRET`, plus
`PLAID_SANDBOX_CLIENT_ID` / `PLAID_SANDBOX_SECRET` — dedicated Plaid
**Sandbox** credentials (from your Plaid Dashboard's Sandbox tab),
deliberately separate from this project's real `PLAID_CLIENT_ID`/
`PLAID_SECRET` above, since `test-plaid-link` uses its own isolated Sandbox
client (`_shared/plaidSandbox.ts`) rather than the shared one those back.

## Updating your transaction data

Data lives in a Supabase Postgres table, `public.transactions` — see
[`SCHEMA.md`](SCHEMA.md#transactions) for the current full column list
(manually-entered rows only ever need `date`, `payee`, `category`,
`amount`; everything else is populated by the Plaid sync path).

To add or update rows, run SQL against the table directly (Supabase SQL
editor, `psql`, or the Supabase MCP tools) — e.g.:

```sql
insert into transactions (date, payee, category, amount)
values ('2026-01-15', 'Some Payee', 'Groceries', -42.50);
```

No code changes or redeploys needed — the `transactions` Edge Function reads
the table live every time the app loads.

## Sync health

Transactions reach the ledger one way: Plaid pushes a webhook, the
`plaid-webhook` function calls `syncItemTransactions`, and that advances
the Item's cursor **only after every write succeeds**. That last part is
what makes the path fragile — a sync that throws leaves the cursor where it
was, so the next webhook re-fetches exactly the same data and fails exactly
the same way. It is a closed loop with no way out.

That is not hypothetical. Between 2026-08-15 and 2026-08-19 an oversized
historical batch made every webhook throw, and nothing recovered or
complained for five days. The reason it went unnoticed is worth
internalising: `plaid-balance-refresh` polls balances hourly on a
completely independent path, so the app kept showing a live, correct
balance next to a ledger frozen five days in the past. Both paths returned
HTTP 200. Nothing anywhere said "stale".

Two jobs now sit under that:

| | Schedule | Job |
|---|---|---|
| Resync | every 6h | `plaid-transaction-resync` syncs every active Item the same way a webhook would, so a lost or failing webhook self-heals rather than freezing the ledger. |
| Health check | hourly | `check_plaid_sync_health()` flags any active Item whose last successful sync is more than 24h old (four missed resync cycles) into `public.sync_health`. |

They're deliberately coupled: `plaid_items.updated_at` is stamped on every
successful sync, so once the 6h resync exists that column is a heartbeat
that ticks whether or not the bank had any activity. Without it, a quiet
account and a wedged one are indistinguishable.

One trap worth knowing if you add another scheduled HTTP job:
`net.http_post`'s `timeout_milliseconds` **defaults to 5000**. Both HTTP
jobs here pass it explicitly (30s for balances, 120s for the resync)
because neither originally did, and production showed six timed-out calls
to one recorded success — the resync that recovered the Aug 15–19 outage
took 27 seconds. The work still completed (the Edge Function runs to the
end and returns 200 even after pg_net has hung up), so nothing was lost;
what it cost was the signal, since `net._http_response` then records a
timeout on every run whether the job succeeded or not. `supabase/tests/sql/cron_jobs.sql`
asserts that every `net.http_post` cron job sets a timeout, so a new one
can't quietly inherit the 5s default. The health check makes no HTTP call
at all and is immune by construction.

**The reporting half is not finished.** `check_plaid_sync_health()` writes
`sync_health` and raises a `WARNING` into `postgres_logs`. Nothing pages
anyone. As it stands you still have to go and look, which is the same
failure mode that let the original outage run — the difference is only that
the answer is now a single query rather than an investigation:

```sql
select item_id, last_synced_at, is_stale, stale_since from public.sync_health;
```

Closing it properly means picking a channel and wiring it up — a Supabase
log-based alert on that `WARNING`, a push notification via the mobile app,
or a banner in the UI (`sync_health` already has an owner-scoped `SELECT`
policy so the client can read its own row without a further migration).

## Access control (Google sign-in + per-user RLS)

The app ships no secrets — just the anon key, which is safe to expose by
design. What's actually gated is data:

- `mobile/app/login.tsx` shows "Continue with Google" when there's no
  session; `mobile/lib/AuthProvider.tsx` holds the auth state and
  `mobile/app/(app)/_layout.tsx` is the gate in front of every
  authenticated screen.
- Every Edge Function the app calls (`transactions`, `plaid-link-token`,
  `plaid-exchange`, `plaid-disconnect`, `query`) has `verify_jwt` enabled,
  so the Supabase gateway rejects a request with no valid Supabase JWT on
  `Authorization` before the function code even runs;
  `supabase/functions/_shared/requireUser.ts` then recovers *which* user
  that JWT belongs to.
- `transactions/index.ts` forwards that same token to PostgREST instead
  of using a service-role key — `transactions`' `auth.uid() = user_id` RLS
  policy is what actually restricts each request to its own rows.

Anyone with a Google account can sign in; only their own transaction data
(rows with a matching `user_id`) is ever visible. A new sign-in starts with
zero rows until transactions are written with their `user_id`.

## Running tests

Three suites: backend logic, the database schema itself, and the app.

**Backend logic (this directory)** — the portable, Node-runnable parts of
the Edge Functions:

```bash
npm install
npm test              # Vitest
npm run test:coverage # same, with coverage (enforces vitest.config.js's thresholds)
```

Covers `_shared/`'s `categoryRules.ts`, `cors.ts`, `plaidExchangeLogic.ts`,
`querySystemPrompt.ts`, `refreshAccountBalances.ts`, `syncItemTransactions.ts`,
`transactionsData.ts` and `verifyPlaidWebhook.ts`. Two are worth calling
out. `syncItemTransactions.ts` is the Plaid ingest path — every
transaction that reaches a ledger from a linked bank goes through it, and
its failure modes (the amount sign flip, the duplicate-account filter, the
manually-edited guard, the relink boundary dedup) corrupt data silently
rather than erroring. `verifyPlaidWebhook.ts` is
the JWT signature check on Plaid's webhook, and since `plaid-webhook` is
deployed `--no-verify-jwt`, it is the *only* thing authenticating that
endpoint; its tests use real ES256 keypairs and real signed tokens rather
than mocking the crypto, so "a forged webhook is rejected" is actually
demonstrated.

**Read the coverage numbers with the config's note in hand.** They are
deliberately low: `all: true` measures the whole of `supabase/functions/`
(≈688 statements), including the ~1,156 lines of Deno-only glue in each
function's `index.ts` that cannot execute under Node at all. The gate
exists to catch regressions, not as a score. `vitest.config.js` lists
exactly what is out of reach and why.

**Database (`supabase/tests/`)** — the schema, its RLS policies, and the
column-level grants, tested against a real Postgres:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=scorecard_test -p 55432:5432 postgres:15

export DATABASE_URL=postgres://postgres:postgres@localhost:55432/scorecard_test
supabase/tests/run.sh                                    # migrations + SQL/RLS tests
npx vitest run supabase/tests/categoryRulesParity.test.ts # TS <-> SQL parity
```

`run.sh` applies `supabase/migrations/` to an empty database and runs
`supabase/tests/sql/`. Two things come out of that:

- **The RLS policies are tested as the security boundary they're claimed
  to be.** Tests run as the real `authenticated`/`anon` roles with a real
  `auth.uid()`, exactly as PostgREST runs a signed-in request — so "user A
  cannot read user B's rows", "`plaid_items.access_token` is unreadable by
  any client", and "no INSERT/DELETE policy means no client can wipe a
  ledger" are demonstrated rather than assumed.
- **The parity test pins the category engine's two implementations
  together.** `categoryRules.ts` (live, per-transaction, during Plaid sync)
  and `apply_category_rules()`/`clean_payee()` (retroactive, bulk, when a
  rule changes) implement the same semantics in two languages. The test
  runs identical inputs through both and asserts identical output —
  without it, the two can drift and the same merchant ends up categorized
  differently in old rows and new ones, with no error anywhere.

`supabase/tests/bootstrap.sql` supplies the Supabase platform primitives
that stock Postgres lacks (the `auth` schema, `auth.uid()`, the three
roles, the default grants on `public`). The policies and grants under test
are the real ones from `supabase/migrations/`; only the platform beneath
them is reconstructed. That file documents precisely what this does and
doesn't prove.

> **Known gap:** `supabase/migrations/` is not self-contained — the oldest
> migration does `alter table public.transactions add column ...` against a
> table that was created by hand before migrations existed, and a later one
> drops two indexes by name that were never created by a migration.
> `bootstrap.sql` reconstructs that pre-migration baseline so the tests can
> run, but it means the schema cannot currently be rebuilt from this repo
> alone. The fix is a baseline migration; it would rewrite migration
> history against the live project, so it's flagged rather than done.

Both suites run in CI (`.github/workflows/ci.yml`) on every push/PR, as
the `edge-function-tests` and `database-tests` jobs.

**App (`mobile/`)** — a three-stage pyramid, from a few seconds to a real
Android emulator to an installable APK. See
[`mobile/README.md`](mobile/README.md#automated-testing) for the full
description; the short version:

```bash
cd mobile
npm test              # Stage 1: Jest unit/component tests
```

Stages 2 (Detox on a real emulator) and 3 (APK build) are manual-dispatch
GitHub Actions workflows, not local commands.

## Project structure

```
├── .github/
│   └── workflows/
│       ├── ci.yml               # Edge Function tests + deploy, on every push/PR
│       ├── cache-warm.yml       # keeps the Gradle/AVD caches from expiring (Mon+Thu)
│       ├── mobile-ci.yml        # mobile/'s Stage 1 (typecheck, lint, unit tests, Metro bundle)
│       ├── mobile-detox.yml     # mobile/'s Stage 2, real-emulator Detox run, manual-dispatch
│       └── mobile-build.yml     # mobile/'s Stage 3, APK build on runner, manual-dispatch
├── mobile/                 # THE APP -- Expo/React Native, see mobile/README.md
├── supabase/functions/
│   ├── _shared/
│   │   ├── requireUser.ts        # recovers the caller's user id from their Supabase JWT
│   │   ├── cors.ts               # CORS headers for the client-facing functions
│   │   ├── transactionsData.ts   # fetch/shape helpers, shared by transactions + query
│   │   ├── transactionsData.test.ts
│   │   ├── categoryRules.ts      # applies category_rules to a row, shared by the sync path
│   │   ├── syncItemTransactions.ts # pulls a Plaid Item's transactions into `transactions`
│   │   ├── refreshAccountBalances.ts # shared by the hourly cron + every sync webhook
│   │   ├── resyncItems.ts        # the 6h safety-net poll behind plaid-transaction-resync
│   │   ├── verifyPlaidWebhook.ts # validates Plaid's webhook signature
│   │   ├── plaidExchangeLogic.ts # pure duplicate-account detection logic
│   │   ├── plaidExchangeLogic.test.ts
│   │   ├── querySystemPrompt.ts  # builds the NL-query system prompt
│   │   ├── plaid.ts              # shared Plaid client (real, Production-configured)
│   │   ├── plaidSandbox.ts       # dedicated Sandbox-only Plaid client, test-plaid-link only
│   │   └── supabaseAdmin.ts      # shared service-role Supabase client
│   ├── transactions/index.ts     # the app's read path, RLS-scoped via the caller's own token
│   ├── plaid-link-token/index.ts
│   ├── plaid-exchange/index.ts
│   ├── plaid-disconnect/index.ts
│   ├── query/index.ts            # holds the Anthropic key server-side
│   ├── plaid-webhook/index.ts    # Plaid calls this directly, --no-verify-jwt
│   ├── plaid-balance-refresh/index.ts  # hourly pg_cron job
│   ├── plaid-transaction-resync/index.ts # 6h pg_cron job; floor under plaid-webhook
│   ├── test-login/index.ts       # mobile testing only -- see mobile/README.md
│   └── test-plaid-link/index.ts  # mobile testing only -- see mobile/README.md
├── supabase/migrations/     # schema history (see the "known gap" note above)
├── supabase/tests/
│   ├── bootstrap.sql        # Supabase platform primitives on stock Postgres
│   ├── run.sh               # applies migrations to an empty DB, runs sql/
│   ├── sql/                 # RLS + column-grant tests, per table
│   └── categoryRulesParity.test.ts  # TypeScript <-> SQL category-engine parity
├── package.json             # Vitest only -- runs the backend tests above
├── vitest.config.js
├── SCHEMA.md                # full database schema reference
└── CLAUDE.md                # standing instructions for Claude Code sessions
```
