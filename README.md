# Analysis — personal ledger dashboard

A React + Recharts dashboard over your transaction history. Ask a question in
plain English; a serverless function forwards the question (never your
transaction data) to Claude, which returns a small JSON filter/chart spec;
the app applies that spec locally and renders the chart + table.

Your transaction data lives in `src/App.jsx` as the `RAW_DATA` array — it
never leaves the browser except as aggregate results you choose to look at.

## 1. Install

```bash
npm install
```

## 2. Get an API key

This needs an **Anthropic API key**, separate from any claude.ai
subscription (Pro/Max don't include API access). Sign up at
[console.anthropic.com](https://console.anthropic.com), add billing, and
create a key.

## 3. Local development

```bash
cp .env.example .env.local
# edit .env.local and paste your real key
npm install -g vercel   # if you don't have it already
vercel dev
```

`vercel dev` runs both the Vite frontend and the `/api/query` serverless
function together, using `.env.local` for the key. (Plain `npm run dev`
only runs the frontend — the API route won't work without `vercel dev` or
a deployed environment.)

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → Import** your repo.
3. In **Project Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Deploy. Vercel auto-detects the Vite build and the `/api` folder as a
   serverless function.

Every future update = `git push` — Vercel redeploys automatically.

## 5. Install on your phone (PWA)

Open the deployed URL on your phone:

- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: menu → Install app

It'll behave like a standalone app — full screen, its own icon, no browser
chrome.

## Updating your transaction data

Right now, updating data means editing `RAW_DATA` in `src/App.jsx` directly
and redeploying (`git push`). There's no in-app upload yet — that's a
natural next step if you want to refresh data without touching code each
time.

## Project structure

```
├── api/
│   └── query.js        # serverless proxy — holds the API key server-side
├── src/
│   ├── App.jsx          # the dashboard (data + logic, ~580KB w/ embedded data)
│   └── main.jsx          # React entry point
├── public/
│   ├── manifest.json     # PWA config
│   └── icon-*.png        # app icons
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```
