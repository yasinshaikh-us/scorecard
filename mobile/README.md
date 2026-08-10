# Fathom — mobile app (Expo / React Native)

Native iOS/Android client for the same backend the web app
([`../src`](../src)) uses — every screen here talks to the same Supabase
project (Postgres, Auth, Edge Functions) via the same URLs, just from a
native shell instead of a browser. See [`../README.md`](../README.md) for
the backend setup (Supabase project, Edge Function deploy/secrets).

This is a from-scratch build, not a port: React Native doesn't share DOM
components with the web app, so nothing under `../src` is reused directly,
though the same pure logic (`../src/logic.js`'s date/money formatting and
filter/group/chart-data logic) is duplicated in
[`lib/format.ts`](lib/format.ts) and [`lib/logic.ts`](lib/logic.ts) rather
than imported, kept behaviorally identical.

## Status

Functionally at parity with the web app's core flows:

- **Auth**: Google sign-in, encrypted session storage.
- **Home**: account balances, last-7-days transaction list.
- **Ask**: natural-language questions → chart (bar/pie/line, tap-to-filter)
  → matching transaction list, via the `query` Edge Function.
- **Plaid Link**: connect a bank (first-login gate + "+ Add bank" on Home)
  and disconnect one (two-step confirmation), via `react-native-plaid-link-sdk`.
- **Category rules**: same "if payee/category contains X, set Y" engine as
  the web app, opened from Home's "Rules" button.
- **Inline transaction editing**: tap a row to edit payee/category, same
  `manually_edited` flag as the web version so rules/Plaid sync don't
  clobber it.

Simplified vs. the web version, tracked here rather than silently dropped:

- Idle-state Ask suggestions are a static tappable list, not the web's
  floating/animated ones (no straightforward RN equivalent without
  pulling in Reanimated).
- No chart tooltip yet (gifted-charts' pointer/tooltip config is a
  separate lift) — tapping a bar/slice/point still filters the list below.
- No row-detail popover on tap/long-press (web's hover-triggered one has
  no direct touch equivalent).
- Category/match-field pickers are a plain bottom-sheet list
  (`components/PickerModal.tsx`), not styled beyond that.
- App icons: `assets/icon.png` / `splash-icon.png` / `favicon.png` are the
  real web app icon (copied from `../public/icon-512.png`); Android's
  *adaptive* icon layers (`android-icon-foreground/background/monochrome.png`)
  are still the Expo template placeholders — those need padding/safe-zone
  work with real image-editing tools (this environment has neither
  Pillow nor ImageMagick) before they'll look right, since Android masks
  the foreground layer into various shapes.

Still to come:

- [ ] App Store / Play Store metadata (screenshots, descriptions, privacy details)
- [ ] Proper Android adaptive icon assets

**Still not verified on a real device or simulator** — built and validated
via `tsc --noEmit`, `npm test` (Jest unit/component tests), and
`expo export` (Metro bundles clean for both iOS and Android targets) in a
sandbox with no Xcode/Android Studio available. See "Automated testing"
below for what that covers and doesn't. Run it for real (see below)
before trusting the UI actually works.

## Setup

```bash
cd mobile
npm install
cp .env.example .env
# edit .env with your Supabase project's URL/anon key (same values as
# the web app's VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
```

## Run

**`react-native-plaid-link-sdk` is a native module — Expo Go can no longer
run this app.** Any screen is fine in Expo Go until you touch Plaid Link
(sign-in, Home minus "+ Add bank", Ask, Rules, inline editing all still
work there), but `createPlaidLinkSession` will throw "native module not
found" the moment it's called. To actually test the whole app, build a
custom dev client instead:

```bash
# Cloud build (no Xcode/Android Studio needed) -- requires a free Expo
# account and `npm install -g eas-cli` / `eas login` first:
eas build --profile development --platform ios     # or android

# Install the resulting build on your device/simulator, then:
npx expo start --dev-client
```

Alternatively, `npx expo prebuild` generates the native `ios`/`android`
projects locally if you'd rather build with Xcode/Android Studio directly.

### Testing on a real iPhone (no Mac needed)

EAS Build runs in Apple's cloud, so building an iOS binary never needs a
Mac. Installing it on a physical iPhone/iPad does need one thing Apple
doesn't offer a free alternative to: a paid **Apple Developer Program**
membership ($99/yr) — without it, the only iOS target you can run at all
is the Simulator, which itself requires a Mac. There's no way around
this fee for real-device testing.

Once you have that membership, the fastest path for solo testing is
EAS's **internal (ad-hoc) distribution** — already what the
`development`/`preview` profiles in `eas.json` use — rather than
TestFlight (which additionally needs an App Store Connect app record and
a submission/processing step, with no real benefit for a single tester):

```bash
npm install -g eas-cli
eas login              # your Expo account
eas device:create      # registers a device's UDID with Apple + EAS
```

`eas device:create` prints a link — open it in **Safari on the iPhone
itself** (not on this machine); it installs a small profile that
captures the device's UDID and registers it, no Xcode required. You'll
also need to authenticate the EAS CLI against your Apple Developer
account once (interactive `eas build` prompts for this the first time,
or run `eas credentials` to set it up ahead of time) — that step needs
your actual Apple ID/password, so it has to happen on a machine you
control, not from an automated build.

After the device is registered and Apple credentials are configured,
trigger the build (either `eas build --profile development --platform
ios` locally, or `.github/workflows/mobile-build.yml` with `platform:
ios`) — EAS automatically provisions the build against your registered
device and, once it finishes, gives you an install link/QR code. Open
that on the iPhone to install directly — no App Store or TestFlight
review wait.

## Auth

Google sign-in works differently here than on the web (`../src/Login.jsx`
redirects the whole page to Google and back — there's no "page" in a
native app). `lib/AuthProvider.tsx` opens Google's consent screen in a
system browser tab (`expo-web-browser`) and catches the redirect via a
deep link on the app's `fathom://` scheme (see `app.json`), using PKCE so
the redirect carries an exchangeable `code` rather than raw tokens. The
session itself is encrypted and stored via `expo-secure-store` +
`AsyncStorage` (`lib/supabase.ts`'s `LargeSecureStore` — SecureStore alone
caps individual values around 2KB, too small for a full session, so only
the AES key lives there).

## Plaid Link

`lib/useBankLink.ts` is the native equivalent of `../src/useBankLink.js`.
`react-native-plaid-link-sdk` v13's API is session-based
(`createPlaidLinkSession({...}).open()`) rather than the web SDK's
token-prop/hook pattern, but the three steps are the same: fetch a
`link_token` from the `plaid-link-token` Edge Function, open Plaid's
native Link UI, exchange the `public_token` it returns via
`plaid-exchange`. The device never sees a real Plaid access token.

Not yet verified against a real Plaid Link session (needs the dev-client
build above, plus real `PLAID_CLIENT_ID`/`PLAID_SECRET` Edge Function
secrets already set per the root README) — the OAuth-redirect-within-Link
flow some institutions use may need additional native configuration
(custom URL scheme registration in Plaid's dashboard, possibly Info.plist
entries) that Plaid's own setup docs cover in more depth than this PR
attempted to verify blind.

## Automated testing

A three-stage pyramid: the bulk of testing is automated and runs without
a phone, so a human is only needed at the final gate (installing a real
build and using it). The one paid/metered stage (EAS build, Stage 3) is
deliberately last: Stage 2 already proves the app actually works, via
real scripted device tests on free-tier resources, before any real build
minutes get spent producing the artifact a human installs.

**Stage 1 — cheap and fast, runs on every push/PR that touches `mobile/`**
(`.github/workflows/mobile-ci.yml`, a few seconds to a couple minutes,
no paid resources):

- **Typecheck** — `npx tsc --noEmit`.
- **Unit/component tests** — `npm test`, via Jest (`jest-expo` preset +
  `@testing-library/react-native`). Covers the pure logic
  (`lib/logic.test.ts`, `lib/format.test.ts` — full parity with
  `../src/logic.test.js`) and the components with real state/interaction
  (`components/TransactionRow.test.tsx`'s inline-edit flow,
  `components/CategoryRulesPanel.test.tsx`'s add/toggle/delete/reapply,
  `components/PickerModal.test.tsx`'s select/cancel). Supabase calls are
  mocked at the module boundary (`jest.mock("../lib/supabase")`) rather
  than hitting a real project. Not yet covered: `AccountBalances`,
  `QueryCard`, `Chart`, and the screen-level components (`home.tsx`,
  `ask.tsx`) — those pull in `react-native-plaid-link-sdk` and
  `react-native-gifted-charts`, native-ish modules that need more setup
  to mock cleanly; adding as time allows.
- **Metro bundle** — `npx expo export` for both iOS and Android. Catches
  bad imports/native-module usage that `tsc` alone (types only, no
  bundling) can't see.

None of this needs a device, emulator, EAS account, or paid service —
it's the same kind of check `tsc`/`expo export`/`jest` would give on a
local machine, just running automatically on every change.

**Stage 2 — scripted UI flows on Firebase Test Lab, on demand**
(`.github/workflows/mobile-detox.yml`, manual-dispatch — a real native
Gradle build plus a cloud device run): [Detox](https://github.com/wix/Detox)
builds an instrumented Android APK pair (`npx detox build -c
android.release`, via `.detoxrc.js`), and Firebase Test Lab runs it as a
standard Android instrumentation test on a real virtual device —
Firebase's Spark (free) plan includes 10 virtual-device test runs/day, no
cost. This is real scripted coverage (tap, assert, tap again), not just
"did it crash" — see `e2e/*.test.js`. Builds via a direct Gradle
invocation on the runner itself, not EAS's cloud build, so it proves the
app actually compiles and works before Stage 3 spends any paid EAS build
minutes on it.

Two things this needed that earlier stages didn't:

- **`plugins/withDetoxTestBuildType.js`** — an Expo config plugin that
  injects one line (`testBuildType System.getProperty('testBuildType',
  'debug')`) into the prebuild-generated `android/app/build.gradle`.
  Bare React Native's community template wires this up by default; Expo's
  prebuild template doesn't, which was only discoverable by actually
  running `expo prebuild` and inspecting the output — without it, the
  androidTest APK Detox builds always targets the debug variant
  regardless of which app build type was actually compiled, which would
  hand Firebase Test Lab a mismatched APK pair.
- **A GCP/Firebase project with Test Lab enabled**, plus a service
  account — the one thing that had to be set up by hand (Google identity
  + billing, not something this session has access to). One-time setup:
  1. Create a Firebase project (or reuse an existing GCP project) at
     [console.firebase.google.com](https://console.firebase.google.com).
  2. In that project, create a service account with the **Cloud Test
     Admin** role (`roles/cloudtestservice.admin` — confirmed from a real
     project's actual IAM policy; an earlier version of this doc guessed
     `roles/cloudtestservice.testAdmin`, which doesn't exist under that
     name) — Firebase console's project settings → Service Accounts page
     can generate one directly — and download its JSON key.
  3. Add the JSON key as a GitHub Actions **secret** named
     `FIREBASE_SERVICE_ACCOUNT_KEY` (the whole file contents).
  4. Add the project's ID as a GitHub Actions **variable** (not secret —
     project IDs aren't sensitive) named `FIREBASE_PROJECT_ID`.
  5. Enable the **Cloud Tool Results API** (`toolresults.googleapis.com`)
     on that project — Firebase Test Lab needs it to store run results,
     but it isn't turned on by default just because Test Lab itself is
     enabled. Same page pattern as any other GCP API:
     `console.developers.google.com/apis/api/toolresults.googleapis.com/overview?project=<your-project-id>`.

  The workflow skips cleanly with a warning if the secret/variable
  aren't set yet. If the service account role or either required API is
  missing, the workflow's own "Preflight -- verify GCP/Firebase
  prerequisites" step catches it in seconds (before the ~13 min build)
  and reports everything missing at once.

**Untested as of this commit** — built from Detox's own verified build
output (confirmed by actually running `expo prebuild` and inspecting the
generated Gradle files and Detox's APK-path-deriving source, not guessed
from docs — most of the reference docs for this specific combination
were unreachable from the sandbox that wrote it) and the documented
Detox-build-then-hand-off-to-`gcloud`-directly pattern other teams use
for this combination, but there was no real GCP project available to run
it against. The Firebase Test Lab device string
(`model=Pixel2,version=30`) in particular is a guess at a
long-available catalog entry, not a verified-current one — if it's been
retired, `gcloud firebase test android models list` (once authenticated)
shows current options. Expect the first real run to need at least one
debugging round, the same as Stage 3's EAS project-linking issues did.

**Stage 3 — EAS build verification, produces the human-installable binary**
(`.github/workflows/mobile-build.yml`, manual-dispatch since EAS build
minutes aren't free): confirms the app compiles into a real native
binary via EAS's own cloud build — a different toolchain than Stage 2's
direct Gradle invocation, with its own project-linking/credential
handling that can fail independently of Gradle itself. Deliberately last: this is the one
paid/metered stage in the pyramid, so it only runs once Stage 2's real
device tests already give confidence the app works, rather than
packaging a build that might be broken in ways only device-level testing
catches. Needs an `EXPO_TOKEN` repo secret: create one at `expo.dev` →
account settings → **Access Tokens**, add it as a GitHub Actions secret
named `EXPO_TOKEN`.

Also needs **`mobile/.npmrc`** (`legacy-peer-deps=true`, already
committed). EAS's remote build workers run their own `npm install` in an
"Install dependencies" phase, separate from any `npm ci` in this repo's
own CI steps — without this file, that install fails with a real
`ERESOLVE` peer-dependency conflict (`react-test-renderer@19.2.8`'s peer
`react` requirement), surfaced only as a generic "Unknown error. See
logs of the Install dependencies build phase" until you go check the
build's own log on `expo.dev`. First hit (and fixed) on the first real
`mobile-build.yml` run (android/preview) that got past this stage's
earlier project-linking issues.

**Final gate — a human on a real device, for whatever Stage 2 doesn't
cover.** Plaid Link's own hosted UI (native WebView content this app
doesn't own, no stable testIDs to match against) still isn't scripted --
see "Test Plaid Link" below for how the *backend* half of that flow (does
linking actually work: token exchange, DB writes, RLS-scoped reads,
balance display) is covered instead, without needing to drive that UI.
Real-device install-and-tap is still how you'd catch a Link UI rendering
bug specifically, or anything else Stage 2 doesn't reach.

### Test login (skipping Google's sign-in screen)

Every authenticated screen (Home, Ask, Rules, editing) needs a session,
and Google's OAuth consent screen actively resists automation — the same
reason the web app's own Playwright tests
(`../tests/e2e/dashboard.spec.js`, `../tests/synthetic/fixtures/monitor-session.js`)
never drive real Google sign-in either, injecting a session directly
instead. `supabase/functions/test-login` is the mobile equivalent: it
mints a real session for a designated dummy account
(`synthetic-monitor@scorecard.test` — the same one the web app's
synthetic monitor already uses) without touching Google at all.

- **Gated to non-production builds only.** `eas.json`'s `development`/
  `preview` profiles set `EXPO_PUBLIC_ENABLE_TEST_LOGIN=true` plus a
  shared `EXPO_PUBLIC_TEST_LOGIN_SECRET`; `production` sets neither, so
  the "Sign in as test user" link on the login screen (and the code
  behind it) is compiled out of any build a real user would install.
- **The account's real password never leaves the server.** The shared
  secret only proves "this build is allowed to ask for a test session" —
  it can't be used to look up or change the account's actual Supabase
  password, and it's independently rotatable (just an Edge Function
  secret) without touching that account's real credentials.
- **Scoped to one hardcoded account.** The function ignores any email the
  caller sends and always mints a session for the same designated dummy
  account — it can't be used to bypass sign-in for a real user.
- **`TEST_LOGIN_SECRET`** is set as an Edge Function secret on the
  Supabase project, matching the value baked into `eas.json`.

This is what Stage 2 (above) actually drives to get past the login wall
— `e2e/testLogin.test.js` taps the "Sign in as test user" link and
asserts Home renders, the first real end-to-end exercise of this
function (nothing in this sandbox could invoke its HTTP endpoint
directly to check it ahead of time — see that spec's comments).

### Test Plaid Link (skipping Plaid's own hosted Link UI)

Plaid Link's own UI is a native WebView Plaid controls, not this app --
no stable `testID`s to script against, and Plaid can change it
independent of anything this app does. Rather than fight that,
`supabase/functions/test-plaid-link` mints a real Plaid **Sandbox**
`public_token` directly via Plaid's own `/sandbox/public_token/create`
endpoint (against `ins_109508`, "First Platypus Bank" -- Plaid's
standard always-available Sandbox institution, the same one the fixed
`user_good`/`pass_good` test credentials work against, though this
endpoint doesn't even need those -- it mints a token as if that login
had already happened) and runs it through the same token-exchange +
sync logic `plaid-exchange`/`syncItemTransactions` use. This verifies
the part of Plaid linking this app actually owns and could have real
bugs in -- token exchange, `plaid_items`/`plaid_accounts` writes,
RLS-scoped reads, balance/transaction sync, and the Home screen actually
rendering the result -- without the fragility of scripting Plaid's own
UI.

- **Isolated from the real Plaid connection structurally, not by a
  runtime check.** This function uses its own dedicated Sandbox-only
  Plaid client (`supabase/functions/_shared/plaidSandbox.ts`), backed by
  separate `PLAID_SANDBOX_CLIENT_ID` / `PLAID_SANDBOX_SECRET` Edge
  Function secrets, hardcoded to Plaid's Sandbox API -- it never reads
  `PLAID_CLIENT_ID`/`PLAID_SECRET`/`PLAID_ENV` or touches
  `_shared/plaid.ts`'s shared client at all. That client backs this
  project's real, Production-linked bank account, and Plaid's Sandbox
  and Production environments don't interoperate (a Sandbox-minted
  token can't be exchanged against Production anyway) -- so this
  function's exchange/cleanup logic is a deliberate, self-contained copy
  of `plaid-exchange`/`plaid-disconnect`'s logic (adapted to the sandbox
  client) rather than a call to those functions, which stay untouched.
- **Gated the same way as test login**: `eas.json`'s `development`/
  `preview` profiles set a separate `EXPO_PUBLIC_TEST_PLAID_LINK_SECRET`
  (independently rotatable from `EXPO_PUBLIC_TEST_LOGIN_SECRET`, same
  reasoning) that must match the `TEST_PLAID_LINK_SECRET` Edge Function
  secret. Even a leaked secret can only ever link a Sandbox test bank
  using Sandbox-only credentials that have no access to any real bank
  data.
- **Idempotent.** Before linking, it disconnects any bank already linked
  to the test account (mirroring `plaid-disconnect`'s logic against the
  sandbox client, so Items are properly revoked at Plaid too) -- Plaid's
  Sandbox test data (including account/routing numbers) is deterministic
  per institution, so without this a second CI run would look like the
  exact same real account relinking, and the duplicate-account detection
  below would reject it.
- **Three Edge Function secrets to set** on the Supabase project (same
  place as `TEST_LOGIN_SECRET`): `TEST_PLAID_LINK_SECRET` (matching the
  value baked into `eas.json`), and `PLAID_SANDBOX_CLIENT_ID` /
  `PLAID_SANDBOX_SECRET` (from your Plaid Dashboard's **Sandbox**
  environment tab -- deliberately separate credentials from this
  project's real `PLAID_CLIENT_ID`/`PLAID_SECRET`, which stay on
  Production). Unlike `test-login`, this function needs `verify_jwt`
  enabled (the platform default, same as `plaid-exchange`) since it
  writes real rows scoped to a real signed-in user -- deploy it the
  normal way (`supabase functions deploy test-plaid-link`), not with
  `--no-verify-jwt`.
- **Triggered from the app, not called directly by the test.** A "Link
  test bank" button (`components/AccountBalances.tsx`, same
  `EXPO_PUBLIC_ENABLE_TEST_LOGIN` gate as "Sign in as test user") calls
  it with the already-signed-in session's token -- `e2e/testPlaidLink.test.js`
  signs in via test login, taps that button, then waits for the linked
  account to actually show up in the Banks strip.

## Before shipping to a store

- `app.json`'s `ios.bundleIdentifier` / `android.package` are placeholders
  (`com.fathom.app`) — change these to your own before running an EAS build.
- You'll need an Apple Developer Program account (iOS, $99/yr) and Google
  Play Console account (Android, $25 one-time) to actually submit.
- Proper Android adaptive icon assets (see Status above).
- `eas.json` has `development`/`preview`/`production` build profiles
  scaffolded; none have been run from this sandbox (no EAS account
  configured here).
