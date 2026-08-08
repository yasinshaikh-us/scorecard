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

A two-stage pyramid: the bulk of testing is automated and runs without a
phone, so a human is only needed at the final gate (installing a real
build and using it).

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

**Stage 2 — EAS build verification, on demand**
(`.github/workflows/mobile-build.yml`, manual-dispatch since EAS build
minutes aren't free): confirms the app compiles into a real native
binary, not just that the JS bundles cleanly — `tsc`/`expo export` can't
catch a broken Gradle config or native-module linking issue (relevant
here given `react-native-plaid-link-sdk`). Needs an `EXPO_TOKEN` repo
secret: create one at `expo.dev` → account settings → **Access Tokens**,
add it as a GitHub Actions secret named `EXPO_TOKEN`.

**Final gate — a human on a real device.** Stage 2's build artifact still
needs to actually be installed and tapped through once — no environment
available here has a connected Android/iOS device or emulator (see "Run"
above), so real UI-flow verification (sign-in, Plaid Link's native OAuth
redirect, chart rendering) can't be automated from this environment.
Cloud device-farm services (e.g. Maestro Cloud) exist for this but run
~$250/device/month and weren't worth it at this stage — revisit if the
manual step becomes the actual bottleneck.

## Before shipping to a store

- `app.json`'s `ios.bundleIdentifier` / `android.package` are placeholders
  (`com.fathom.app`) — change these to your own before running an EAS build.
- You'll need an Apple Developer Program account (iOS, $99/yr) and Google
  Play Console account (Android, $25 one-time) to actually submit.
- Proper Android adaptive icon assets (see Status above).
- `eas.json` has `development`/`preview`/`production` build profiles
  scaffolded; none have been run from this sandbox (no EAS account
  configured here).
