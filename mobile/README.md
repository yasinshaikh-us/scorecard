# Fathom — mobile app (Expo / React Native)

Native iOS/Android client for the same backend the web app
([`../src`](../src)) uses — every screen here talks to the same Supabase
project (Postgres, Auth, Edge Functions) via the same URLs, just from a
native shell instead of a browser. See [`../README.md`](../README.md) for
the backend setup (Supabase project, Edge Function deploy/secrets).

This is a from-scratch build, not a port: React Native doesn't share DOM
components with the web app, so nothing under `../src` is reused directly,
though the same pure logic (`../src/logic.js`'s date/money formatting) is
duplicated in [`lib/format.ts`](lib/format.ts) rather than imported, kept
behaviorally identical.

## Status

**Phase 1 (this PR): auth + Home screen.** Sign in with Google, see your
linked-account balances and the last 7 days of transactions. Everything
else from the web app is still to come:

- [ ] Ask page (natural-language queries + charts)
- [ ] Plaid Link (connect/disconnect a bank from the app)
- [ ] Category rules panel, inline transaction editing
- [ ] App icons/splash, EAS build config, store metadata

**Not yet verified on a real device or simulator** — built and validated
via `tsc --noEmit` and `expo export` (Metro bundles clean for both iOS and
Android targets) in a sandbox with no Xcode/Android Studio available. Run
it for real (see below) before trusting the UI actually works.

## Setup

```bash
cd mobile
npm install
cp .env.example .env
# edit .env with your Supabase project's URL/anon key (same values as
# the web app's VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
```

## Run

```bash
npx expo start
```

Scan the QR code with the Expo Go app (iOS/Android), or press `i` / `a` to
launch an iOS Simulator / Android Emulator if you have Xcode / Android
Studio installed locally.

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

## Before shipping to a store

`app.json`'s `ios.bundleIdentifier` / `android.package` are placeholders
(`com.fathom.app`) — change these to your own before running an EAS build,
and you'll need an Apple Developer Program account (iOS) and Google Play
Console account (Android) to actually submit. Neither is required to run
the app locally via Expo Go.
