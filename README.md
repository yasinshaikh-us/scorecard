# Analysis — personal ledger dashboard

A React + Recharts dashboard over your transaction history. Ask a question in
plain English; a serverless function forwards the question (never your
transaction data) to Claude, which returns a small JSON filter/chart spec;
the app applies that spec locally and renders the chart + table.

Your transaction data lives in a Supabase Postgres table, read on load
through a serverless proxy (`/api/transactions`) using a service-role key
that never reaches the browser. Row Level Security is enabled on the table
with no policies, so the anon/publishable key — the one that would ever be
exposed to a client — has zero access to it.

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
  `category`, `amount`) — see "Updating your transaction data" below. From
  **Project Settings → API Keys**, grab the **Project URL** and an elevated
  key — either the legacy `service_role` JWT (Legacy keys tab) or the newer
  `sb_secret_...` key (Publishable and secret API keys tab). Not the
  anon/publishable key — RLS on the table has no policies, so only an
  elevated key can read it.

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
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase `service_role` JWT or `sb_secret_...` key
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

## PIN-locking the app

By default the app is public to anyone with the URL. To require a PIN:

1. In Vercel: **Project Settings → Environment Variables**
2. Add `SITE_PIN` = a 4-8 digit number of your choice (e.g. `4821`), for all three environments (Production, Preview, Development)
3. Push/redeploy

Visiting the app now shows a PIN entry screen first. Enter it once and it's
remembered on that browser/device for 30 days via a cookie — no need to
re-enter it every time you open the PWA.

To remove the lock entirely, delete the `SITE_PIN` environment variable and
redeploy (the middleware auto-disables itself if `SITE_PIN` isn't set, so
you're never at risk of being locked out by a misconfiguration).

This is implemented via `middleware.js` at the project root — a
framework-agnostic Vercel feature (works on the free Hobby plan, unlike
Vercel's built-in Password Protection which requires a paid add-on).

## Project structure

```
├── api/
│   ├── query.js         # serverless proxy — holds the Anthropic key server-side
│   └── transactions.js  # serverless proxy — reads Supabase with the service-role key
├── src/
│   ├── App.jsx          # the dashboard (logic only, no embedded data)
│   ├── styles.js        # shared inline-style objects for App.jsx
│   └── main.jsx         # React entry point
├── public/
│   ├── manifest.json    # PWA config
│   └── icon-*.png       # app icons
├── middleware.js         # optional PIN gate (see above)
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```
