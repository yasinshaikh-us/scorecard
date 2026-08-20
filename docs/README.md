# docs/ — the public site

Static pages served by GitHub Pages, hosting the two URLs the Google Play
Console requires and neither of which Play will accept as a PDF, a Google
Doc, or anything behind a login:

| Page | Play Console field |
|---|---|
| `privacy.html` | App content → Privacy policy, **and** Store listing → Privacy policy |
| `account-deletion.html` | App content → Data deletion (the web request URL) |
| `index.html` | Not required by Play; a landing page linking both, and something to put in the "website" field of an organization developer account |

## Enabling Pages

One repository setting, which has to be done by hand — the GitHub API this
session can reach doesn't cover Pages configuration:

**Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / `/docs` → Save.**

The pages then serve at:

- `https://yasinshaikh-us.github.io/scorecard/privacy.html`
- `https://yasinshaikh-us.github.io/scorecard/account-deletion.html`

The repo is public, so Pages is free. Deployment takes a minute or two
after each push to `main`; check **Actions → pages-build-deployment** if a
change doesn't appear.

`.nojekyll` disables Jekyll processing. Nothing here needs it, and without
the file a future page whose name starts with an underscore would silently
404.

## Keeping the policy honest

`privacy.html` describes what the code actually does, not a template. It
was written against the real backend, and these specific claims are load-
bearing — if any of them stops being true, the policy is wrong and the Play
data safety declaration becomes inconsistent with it, which is a rejection
reason:

- **Individual transactions are never sent to Anthropic.** `supabase/functions/query/`
  sends only the ledger's *shape* — category names, account display labels,
  and the min/max transaction date, from `fetchLedgerMeta` and
  `fetchAccountLabels` — plus the user's question text. The model returns a
  query that is then run server-side against the user's own rows. If that
  function is ever changed to pass transaction rows into the prompt, this
  page must change with it.
- **Bank credentials never touch the app or our servers.** They're entered
  in Plaid's own interface; we hold only the access token, server-side.
- **Account and routing numbers are stored** (`plaid_auth_numbers`), and the
  policy says so. This is a data type Play's data safety form asks about
  directly.
- **No advertising, no analytics, no tracking SDKs, no location.** True as
  of now; adding any of them means updating both this page and the data
  safety form.

The contact address in both pages is `yasin.shaikh@gmail.com`. If a support
address on the app's own domain ever exists, switch to it — a personal
Gmail on a finance app's privacy policy is permitted but looks like what it
is.
