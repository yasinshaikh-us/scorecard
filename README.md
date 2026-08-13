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

```bash
supabase functions deploy transactions plaid-link-token plaid-exchange plaid-disconnect query
```

Set these as Edge Function secrets first (Project Settings → Edge Functions
→ Secrets, or `supabase secrets set`) — `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected, no
action needed for those three:

- `ANTHROPIC_API_KEY`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`

All five of these functions expect `verify_jwt` enabled (the platform
default) — the gateway rejects any request without a valid Supabase JWT on
`Authorization` before the function code runs. `plaid-webhook` is the one
exception in this project (deployed with `--no-verify-jwt`, since Plaid
calls it directly, not a signed-in user) — see
`supabase/functions/plaid-webhook`.

Two more functions exist purely to support the app's automated testing
(see `mobile/README.md`'s "Test login" / "Test Plaid Link" sections) and
aren't needed to run the app normally:
`supabase functions deploy test-login --no-verify-jwt` and
`supabase functions deploy test-plaid-link` (this one keeps `verify_jwt`
enabled, like the five above — it needs a real signed-in user). `test-login`
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

Two independent suites, one per half of the project.

**Backend (this directory)** — the portable, Node-runnable logic inside
the Edge Functions:

```bash
npm install
npm test              # Vitest
npm run test:coverage # same, with coverage (enforces vitest.config.js's thresholds)
```

This covers `supabase/functions/_shared/transactionsData.ts` and
`plaidExchangeLogic.ts`. The Deno-only glue in each function's `index.ts`
(and in `_shared/plaid.ts` / `_shared/supabaseAdmin.ts`) isn't covered by
Vitest — it depends on `Deno.serve`/`Deno.env` and `npm:` imports that only
resolve under the Deno runtime. Runs in CI (`.github/workflows/ci.yml`) on
every push/PR.

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
│   ├── dependabot.yml    # weekly npm (root + mobile/) + github-actions updates
│   └── workflows/
│       ├── ci.yml               # Edge Function tests, on every push/PR
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
│   ├── test-login/index.ts       # mobile testing only -- see mobile/README.md
│   └── test-plaid-link/index.ts  # mobile testing only -- see mobile/README.md
├── supabase/migrations/     # schema history
├── package.json             # Vitest only -- runs the Edge Function tests above
├── vitest.config.js
├── SCHEMA.md                # full database schema reference
└── CLAUDE.md                # standing instructions for Claude Code sessions
```
