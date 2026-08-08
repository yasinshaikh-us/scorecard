# Fathom — personal ledger dashboard

A React + Recharts dashboard over your transaction history. Ask a question in
plain English; a Supabase Edge Function forwards the question (never your
transaction data) to Claude, which returns a small JSON filter/chart spec;
the app applies that spec locally and renders the chart + table.

Your transaction data lives in a Supabase Postgres table, read on load
through a Supabase Edge Function (`transactions`) that forwards your
signed-in Google session's own access token to Supabase. Row Level Security
on the table restricts every request to that user's own rows (`auth.uid() =
user_id`) — Postgres enforces the isolation, not app code.

The backend is entirely on Supabase — Postgres, Auth, and every server-side
function (both the ones the client calls directly and the Plaid
webhook/cron jobs) live on one platform. Vercel's only remaining job is
hosting the static SPA build.

See [`SCHEMA.md`](SCHEMA.md) for the full database schema — every table,
column, constraint, and RLS policy, including the Plaid bank-sync tables.

## 1. Install

```bash
npm install
```

## 2. Get your keys

This needs:

- An **Anthropic API key**, separate from any claude.ai subscription
  (Pro/Max don't include API access). Sign up at
  [console.anthropic.com](https://console.anthropic.com), add billing, and
  create a key.
- A **Supabase project** with a `transactions` table (`date`, `payee`,
  `category`, `amount`, `user_id`) — see "Updating your transaction data"
  below. From **Project Settings → API Keys**, grab the **Project URL** and
  the **anon/publishable key** (safe to expose to the browser by design).
- **Google enabled as a sign-in provider** on that Supabase project
  (Authentication → Providers → Google), with a Client ID/Secret from a
  Google Cloud OAuth client whose authorized redirect URI is
  `<Project URL>/auth/v1/callback`. This is a one-time dashboard step, not
  an env var.

## 3. Local development

```bash
cp .env.example .env.local
# edit .env.local and paste your real keys
npm run dev              # Vite frontend only
supabase functions serve # Edge Functions, in a second terminal (needs the Supabase CLI)
```

`supabase functions serve` needs its own env vars (`PLAID_CLIENT_ID`,
`PLAID_SECRET`, `PLAID_ENV`, `ANTHROPIC_API_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`) — pass an env file with `--env-file`, or
`supabase secrets set` them for a linked project. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are provided automatically.

## 4. Deploy

**Frontend (Vercel):**

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → Import** your repo.
3. In **Project Settings → Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Supabase project URL — the browser bundle uses this both to redirect to Google and to build the Edge Function URLs it calls
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/publishable key (safe to expose by design)
4. Deploy. Vercel auto-detects the Vite build — there's no `/api` folder
   anymore, so it deploys the static SPA only.

Every future update = `git push` — Vercel redeploys automatically.

**Backend (Supabase Edge Functions):**

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

## 5. Install on your phone (PWA)

Open the deployed URL on your phone:

- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: menu → Install app

It'll behave like a standalone app — full screen, its own icon, no browser
chrome.

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
the table live on every page load.

## Access control (Google sign-in + per-user RLS)

The app itself (the static SPA shell) is public — it contains no secrets,
just the anon key, which is safe to expose by design. What's actually
gated is data:

- `src/Login.jsx` shows "Continue with Google" when there's no session
  (`src/App.jsx`'s top-level auth gate, checked via
  `supabase.auth.getSession()`).
- Every Edge Function the client calls (`transactions`, `plaid-link-token`,
  `plaid-exchange`, `plaid-disconnect`, `query`) has `verify_jwt` enabled,
  so the Supabase gateway rejects a request with no valid Supabase JWT on
  `Authorization` before the function code even runs;
  `supabase/functions/_shared/requireUser.ts` then recovers *which* user
  that JWT belongs to.
- `transactions`/`index.ts` forwards that same token to PostgREST instead
  of using a service-role key — `transactions`' `auth.uid() = user_id` RLS
  policy is what actually restricts each request to its own rows.

Anyone with a Google account can sign in; only their own transaction data
(rows with a matching `user_id`) is ever visible. A new sign-in starts with
zero rows until transactions are written with their `user_id`.

## Running tests

```bash
npm test          # unit tests (Vitest) — pure logic + Edge Function shared helpers
npm run test:e2e   # one end-to-end smoke test (Playwright), mocked APIs, no real credentials needed
```

`npm test` is fast (no browser) and covers `src/logic.js`
(filtering/grouping/date math) and the portable logic under
`supabase/functions/_shared/` (`transactionsData.ts`,
`plaidExchangeLogic.ts`). The Deno-only glue in each function's `index.ts`
(and in `_shared/plaid.ts` / `_shared/supabaseAdmin.ts`) isn't covered by
Vitest — it depends on `Deno.serve`/`Deno.env` and `npm:` imports that only
resolve under the Deno runtime, same as the pre-existing `plaid-webhook` and
`plaid-balance-refresh` functions. `npm run test:e2e` builds the app, serves
it locally, and drives it in a real browser with the Edge Function calls
mocked at the network layer.

Both run in CI (`.github/workflows/ci.yml`) on every push/PR, gated in order:
build → unit tests → smoke test, so a broken build or a fast unit-test
failure surfaces before the slower browser test ever runs.

## Project structure

```
├── .github/workflows/
│   └── ci.yml           # build -> unit tests -> smoke test, on every push/PR
├── supabase/functions/
│   ├── _shared/
│   │   ├── requireUser.ts        # recovers the caller's user id from their Supabase JWT
│   │   ├── cors.ts                # CORS headers for the client-facing functions
│   │   ├── transactionsData.ts    # fetch/shape helpers, shared by transactions + query
│   │   ├── transactionsData.test.ts
│   │   ├── plaidExchangeLogic.ts  # pure duplicate-account detection logic
│   │   ├── plaidExchangeLogic.test.ts
│   │   ├── querySystemPrompt.ts   # builds the NL-query system prompt
│   │   ├── plaid.ts               # shared Plaid client
│   │   └── supabaseAdmin.ts       # shared service-role Supabase client
│   ├── transactions/index.ts      # replaces the old api/transactions.js
│   ├── plaid-link-token/index.ts
│   ├── plaid-exchange/index.ts
│   ├── plaid-disconnect/index.ts
│   ├── query/index.ts             # holds the Anthropic key server-side
│   ├── plaid-webhook/index.ts     # Plaid calls this directly, --no-verify-jwt
│   └── plaid-balance-refresh/index.ts  # hourly pg_cron job
├── src/
│   ├── App.jsx          # auth gate (Login vs dashboard) + the dashboard itself
│   ├── Login.jsx        # "Continue with Google" screen
│   ├── supabaseClient.js # browser Supabase client (anon key)
│   ├── functionsClient.js # builds Supabase Edge Function URLs
│   ├── logic.js         # pure filtering/grouping/date-math logic, unit tested
│   ├── logic.test.js
│   ├── styles.js        # shared inline-style objects for App.jsx
│   └── main.jsx         # React entry point
├── tests/e2e/
│   └── dashboard.spec.js  # Playwright smoke test
├── public/
│   ├── manifest.json    # PWA config
│   └── icon-*.png       # app icons
├── playwright.config.js
├── index.html
├── package.json
├── vite.config.js       # includes Vitest's `test` config block
└── vercel.json          # static SPA hosting only — no serverless functions
```
