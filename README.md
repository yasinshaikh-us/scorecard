# Analysis — personal ledger dashboard

A React + Recharts dashboard over your transaction history. Ask a question in
plain English; a serverless function forwards the question (never your
transaction data) to Claude, which returns a small JSON filter/chart spec;
the app applies that spec locally and renders the chart + table.

Your transaction data lives in a Supabase Postgres table, read on load
through a serverless proxy (`/api/transactions`) that forwards your signed-in
Google session's own access token to Supabase. Row Level Security on the
table restricts every request to that user's own rows (`auth.uid() =
user_id`) — Postgres enforces the isolation, not app code.

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
npm install -g vercel   # if you don't have it already
vercel dev
```

`vercel dev` runs both the Vite frontend and the `/api` serverless
functions together, using `.env.local` for the keys. (Plain `npm run dev`
only runs the frontend — the API routes won't work without `vercel dev` or
a deployed environment.)

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → Import** your repo.
3. In **Project Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
   - `SUPABASE_URL` = your Supabase project URL (read server-side, in `middleware.js`)
   - `VITE_SUPABASE_URL` = the same project URL (exposed to the browser bundle, so the sign-in button can redirect to Google)
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/publishable key (also exposed to the browser — safe by design)
4. Deploy. Vercel auto-detects the Vite build and the `/api` folder as
   serverless functions.

Every future update = `git push` — Vercel redeploys automatically.

## 5. Install on your phone (PWA)

Open the deployed URL on your phone:

- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: menu → Install app

It'll behave like a standalone app — full screen, its own icon, no browser
chrome.

## Updating your transaction data

Data lives in a Supabase Postgres table, `public.transactions`:

| column   | type          | notes                                  |
|----------|---------------|-----------------------------------------|
| date     | date          | `YYYY-MM-DD`                            |
| payee    | text          |                                          |
| category | text          | `Top:Sub` format (e.g. `Home:Rent`)     |
| amount   | numeric(12,2) | negative for expenses, positive for income |

To add or update rows, run SQL against the table directly (Supabase SQL
editor, `psql`, or the Supabase MCP tools) — e.g.:

```sql
insert into transactions (date, payee, category, amount)
values ('2026-01-15', 'Some Payee', 'Groceries', -42.50);
```

No code changes or redeploys needed — `/api/transactions` reads the table
live on every page load.

## Access control (Google sign-in + per-user RLS)

The app itself (the static SPA shell) is public — it contains no secrets,
just the anon key, which is safe to expose by design. What's actually
gated is data:

- `src/Login.jsx` shows "Continue with Google" when there's no session
  (`src/App.jsx`'s top-level auth gate, checked via
  `supabase.auth.getSession()`).
- `middleware.js` (a framework-agnostic Vercel Routing Middleware — works
  on the free Hobby plan) rejects any `/api/*` request that doesn't carry
  a valid `Authorization: Bearer <token>` header, verified against
  Supabase's Auth API.
- `api/transactions.js` forwards that same token to PostgREST instead of
  using a service-role key — `transactions`' `auth.uid() = user_id` RLS
  policy is what actually restricts each request to its own rows.

Anyone with a Google account can sign in; only their own transaction data
(rows with a matching `user_id`) is ever visible. A new sign-in starts with
zero rows until transactions are written with their `user_id`.

## Running tests

```bash
npm test          # unit tests (Vitest) — pure logic + serverless functions + middleware
npm run test:e2e   # one end-to-end smoke test (Playwright), mocked APIs, no real credentials needed
```

`npm test` is fast (no browser) and covers `src/logic.js` (filtering/grouping/date
math), `api/transactions.js`, `api/query.js`, and `middleware.js`. `npm run
test:e2e` builds the app, serves it locally, and drives it in a real browser
with `/api/transactions` and `/api/query` mocked at the network layer.

Both run in CI (`.github/workflows/ci.yml`) on every push/PR, gated in order:
build → unit tests → smoke test, so a broken build or a fast unit-test
failure surfaces before the slower browser test ever runs.

## Project structure

```
├── .github/workflows/
│   └── ci.yml           # build -> unit tests -> smoke test, on every push/PR
├── api/
│   ├── query.js         # serverless proxy — holds the Anthropic key server-side
│   ├── query.test.js
│   ├── transactions.js  # serverless proxy — forwards the caller's own token to Supabase (RLS-scoped)
│   └── transactions.test.js
├── src/
│   ├── App.jsx          # auth gate (Login vs dashboard) + the dashboard itself
│   ├── Login.jsx        # "Continue with Google" screen
│   ├── supabaseClient.js # browser Supabase client (anon key)
│   ├── logic.js         # pure filtering/grouping/date-math logic, unit tested
│   ├── logic.test.js
│   ├── styles.js        # shared inline-style objects for App.jsx
│   └── main.jsx         # React entry point
├── tests/e2e/
│   └── dashboard.spec.js  # Playwright smoke test
├── public/
│   ├── manifest.json    # PWA config
│   └── icon-*.png       # app icons
├── middleware.js         # gates /api/* behind a valid Supabase session (see above)
├── middleware.test.js
├── playwright.config.js
├── index.html
├── package.json
├── vite.config.js       # includes Vitest's `test` config block
└── vercel.json
```
