# fa/thm — mobile app (Expo / React Native)

**This is the app.** Every screen talks to the Supabase project (Postgres,
Auth, Edge Functions) in [`../supabase`](../supabase); see
[`../README.md`](../README.md) for the backend setup (Supabase project,
Edge Function deploy/secrets).

A React web app at the repo root was the original client, and this was
built from scratch to replace it — not ported, since React Native shares
no DOM components with it. That web app has since been removed; the pure
logic it held (date/money formatting, filter/group/chart-data) lives here
in [`lib/format.ts`](lib/format.ts) and [`lib/logic.ts`](lib/logic.ts),
which were written as behaviorally identical duplicates of it and are now
the only copy.

## Status

Covers the full set of flows this app is meant to have:

- **Auth**: Google sign-in, encrypted session storage.
- **Home**: account balances (one row per linked account), last-7-days
  transaction list.
- **Navigation**: no tab bar. `ScreenHeader`'s second slot cross-navigates
  between the app's two screens — Ask from Home, Home from Ask — so the
  control is never a no-op pointing at the screen you are already on. With
  only two destinations, a persistent bottom bar was a lot of permanent
  furniture, and it sat in the thumb area the transaction list wants.
- **No worded buttons**: every control in the app is a glyph. Fill carries
  the meaning that the label used to — accent for the affirmative action,
  danger for the destructive one, outline for dismiss, no fill for a
  control beside an input. Every icon-only control carries an
  `accessibilityLabel`, which is now the whole screen-reader surface of
  the UI; `components/IconButton.tsx` is the single shape they all use,
  and it pads any circle under 44pt out to a 44pt touch target.
- **Ask**: natural-language questions → chart (bar/pie/line, tap-to-filter)
  → matching transaction list, via the `query` Edge Function.
- **Plaid Link**: connect a bank (first-login gate + the add button on
  Home) and disconnect one (two-step confirmation), via
  `react-native-plaid-link-sdk`.
- **Category rules**: an "if payee/category contains X, set Y" engine,
  opened from the header's rules button.
- **Inline transaction editing**: tap a row to edit payee/category, same
  `manually_edited` flag the backend respects, so rules/Plaid sync don't
  clobber it.

Deliberately simpler than originally designed, tracked here rather than
silently dropped:

- ~~Idle-state Ask suggestions are a static tappable list, not floating
  or animated.~~ **Done** — `components/RisingSuggestions.tsx` drifts them
  upward as bare text, scattered left/centre/right, via
  `react-native-reanimated`. Respecting the OS reduce-motion setting
  swaps in a plain static column rather than freezing the animated one:
  the drifting layout stacks absolutely-positioned items in a single
  space, so held still they would all render on top of each other.
- No chart tooltip yet (gifted-charts' pointer/tooltip config is a
  separate lift) — tapping a bar/slice/point still filters the list below.
- No row-detail popover on tap/long-press (the original was
  hover-triggered, which has no direct touch equivalent).
- Category/match-field pickers are a plain bottom-sheet list
  (`components/PickerModal.tsx`), not styled beyond that.
- App icons: `assets/icon.png` / `splash-icon.png` / `favicon.png` all use
  the project's mark. Android's
  *adaptive* icon layers (`android-icon-foreground/background/monochrome.png`)
  are now generated from that same mark too — the cream "F" glyph alone,
  padded to stay within Android's ~66%-of-canvas safe zone on a solid
  `#14181D` background layer, since Android masks the foreground into
  various launcher shapes (circle, squircle, etc.) and would otherwise
  clip a full-bleed icon.

Still to come:

- [ ] App Store / Play Store metadata (screenshots, descriptions, privacy details)

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
# from Supabase: Project Settings -> API Keys)
```

## Run

**`react-native-plaid-link-sdk` is a native module — Expo Go can no longer
run this app.** Any screen is fine in Expo Go until you touch Plaid Link
(sign-in, Home minus the add-bank button, Ask, Rules, inline editing all still
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

Google sign-in works differently in a native app than in a browser: there
is no "page" to redirect away and back. `lib/AuthProvider.tsx` opens
Google's consent screen in a
system browser tab (`expo-web-browser`) and catches the redirect via a
deep link on the app's `fathom://` scheme (see `app.json`), using PKCE so
the redirect carries an exchangeable `code` rather than raw tokens. The
session itself is encrypted and stored via `expo-secure-store` +
`AsyncStorage` (`lib/supabase.ts`'s `LargeSecureStore` — SecureStore alone
caps individual values around 2KB, too small for a full session, so only
the AES key lives there).

## Plaid Link

`lib/useBankLink.ts` owns the bank-linking flow.
`react-native-plaid-link-sdk` v13's API is session-based
(`createPlaidLinkSession({...}).open()`) rather than the token-prop/hook
pattern Plaid's browser SDK uses, but the three steps are the same: fetch a
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

## Stage 2's ledger is empty

`synthetic-monitor@scorecard.test` -- the account Stage 2 signs in as --
has **no transactions** (0 rows, confirmed against the database). Every
Ask flow on that stage therefore renders a card reading "No matching
transactions": no chart, no stat block, no list.

Two consequences, both easy to mistake for coverage:

* Stage 2's Ask specs can only assert that a card came back. Anything
  about its contents -- the total, the chart type, the number of
  buckets, the 200-row cap -- has nothing to match against, and specs
  asserting those were removed after failing for exactly that reason.
* The `ask-screen-*` screenshots in the `detox-results` artifact show
  that empty card. They are not evidence that any chart renders
  correctly, and should not be read as such.

Fixing it means giving the monitor account a deterministic ledger of its
own (a seeded fixture, cleaned up per run), not more assertions.
`mobile/lib/testLedger.ts` already generates a realistic one for the
Stage 1 tests and would be the obvious source.

## Automated testing

A three-stage pyramid: the bulk of testing is automated and runs without
a phone, so a human is only needed at the final gate (installing a real
build and using it). Every stage runs entirely on GitHub-hosted runners
— no paid or third-party build service anywhere in the pyramid. The
slowest stage (Stage 3's full native Gradle build, ~10–20 minutes cold)
is deliberately last: Stages 1 and 2 give much faster feedback, so
there's no point packaging a binary that might be broken in ways they'd
already have caught.

**Stage 1 — cheap and fast, runs on every push/PR that touches `mobile/`**
(`.github/workflows/mobile-ci.yml`, a few seconds to a couple minutes,
no paid resources):

- **Typecheck** — `npx tsc --noEmit`.
- **Lint** — `npm run lint`, via [oxlint](https://oxc.rs/docs/guide/usage/linter.html)
  (`.oxlintrc.json`: react-hooks rules, unused vars, empty-assertion tests,
  etc). Not ESLint/typescript-eslint: that stack hard-refuses to load
  against this project's TS 7 compiler (see AGENTS.md) since it depends on
  the old JS Program/TypeChecker API TS 7 no longer ships; oxlint has its
  own Rust-based parser and isn't affected, and is fast enough to belong
  in Stage 1.
- **Unit/component tests** — `npm test`, via Jest (`jest-expo` preset +
  `@testing-library/react-native`). Covers the pure logic
  (`lib/logic.test.ts`, `lib/format.test.ts`), the components with real
  state/interaction
  (`components/TransactionRow.test.tsx`'s inline-edit flow,
  `components/CategoryRulesPanel.test.tsx`'s add/toggle/delete/reapply,
  `components/PickerModal.test.tsx`'s select/cancel, `components/
  AccountBalances.test.tsx`, `components/QueryCard.test.tsx`'s four card
  states, `components/Chart.test.tsx`'s pie/line/bar prop-shaping via a
  mocked `react-native-gifted-charts`), and the screen/layout components
  (`app/(app)/_layout.test.tsx` -- including the plaid_items check's
  fail-open error branch, `app/(app)/home.test.tsx`, `app/(app)/
  ask.test.tsx` -- including the 401 -> forced-sign-out path, `app/
  login.test.tsx`, `app/index.test.tsx`). Supabase calls are mocked at the
  module boundary (`jest.mock("../lib/supabase")`) rather than hitting a
  real project. `npm run test:coverage` runs the same suite with coverage
  enabled; `package.json`'s `jest.coverageThreshold` fails CI if coverage
  drops below the checked-in baseline (currently ~96%/88%/92%/98%
  statements/branches/functions/lines).
- **Metro bundle** — `npx expo export` for both iOS and Android. Catches
  bad imports/native-module usage that `tsc` alone (types only, no
  bundling) can't see.

None of this needs a device, emulator, EAS account, or paid service —
it's the same kind of check `tsc`/`expo export`/`jest` would give on a
local machine, just running automatically on every change.

**Stage 2 — scripted UI flows on a real Android emulator**
(`.github/workflows/mobile-detox.yml`: the smoke subset on any PR
touching `mobile/`, the full suite nightly, and either one on manual
dispatch — a real native Gradle build plus a real emulator boot):
[Detox](https://github.com/wix/Detox)
builds an instrumented Android APK pair (`npx detox build -c
android.release`, via `.detoxrc.js`), then `detox test` runs the real
`e2e/*.test.js` files against a hardware-accelerated (KVM) Android
emulator booted directly on the GitHub Actions runner
([reactivecircus/android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner))
— no paid or third-party service. This is real scripted coverage (tap,
assert, tap again), not just "did it crash."

This corrects an earlier design that handed the built APKs straight to
`gcloud firebase test android run` (Firebase Test Lab), bypassing `detox
test` entirely. That looked like it worked — Firebase Test Lab reported
"Passed" run after run — but it was a false positive the whole time.
Detox's Android architecture runs the actual JS test code on a **host**
machine (`detox test`'s own Jest process), which drives a thin on-device
bridge over a live connection; the androidTest APK Detox builds contains
no JS test logic of its own. With no host process anywhere in that
pipeline, nothing was ever actually executing — confirmed two
independent ways: every run's raw `instrumentation.results` said `"OK (0
tests)"`, and a direct database check found zero real Plaid Sandbox
links ever created despite `testPlaidLink.test.js` reporting "Passed"
repeatedly. (Genymotion SaaS is Detox's own first-class-documented cloud
alternative — same host-driven model, a remote device instead of a local
one — but needs a new third-party account and credentials; a real local
emulator needs neither, and exercises Detox's most mature,
best-supported code path.)

Four spec files, one Gradle build + one emulator boot: `smoke.test.js`
(signed-out sign-in screen); `testLogin.test.js` (the test-login bypass,
plus confirming a signed-in session survives a real app relaunch — see
below); `testPlaidLink.test.js` (the Plaid Link bypass, covered below);
and `appFlows.test.js` — everything else: the Rules engine (add/toggle/
delete a rule, including one that sets payee rather than category, and
cancelling a picker without selecting), editing a transaction's category
(both saving and cancelling), the account-management banners' cancel
paths (real Plaid Link and a real bank disconnect can't be scripted —
see "Test Plaid Link" below and this spec's own header comment), tab
navigation, both Ask paths (a suggestion chip and typing a custom
question), Home's pull-to-refresh gesture, and sign-out. Deliberately
one file for all of that rather than one per screen — each `describe`
block's own `device.launchApp` reinstalls the app, which adds up across
files.

**State hygiene: nothing is assumed, everything is reset.** These specs
drive one real, shared Supabase account, so anything a run leaves behind
is the next run's problem. That used to be handled by assumption —
`appFlows.test.js` opened by asserting the account "has no OTHER
category_rules of its own at the start of a run", and matched rows
positionally (`.atIndex(0)`) on the strength of it. The assumption was
violated by the suite's own failure mode: a spec that died before its
cleanup orphaned a rule, so the next run's `.atIndex(0)` deleted the
*leftover* instead of the row it had just created, failed, and orphaned
another. One flake became a permanently red suite that only a human
clearing the table by hand could fix.

Four things replace that assumption, and together they are what make a
shared fixture survivable:

- **`e2e/globalSetup.js`** wipes every leftover `e2e-*` rule before the
  device boots. It is the only step guaranteed to run — a cancelled job,
  a crashed emulator, or a spec failing before its own cleanup all skip
  teardown — and it fails the run outright if it can't, rather than
  testing against unknown state.
- **Run-scoped data.** Every rule is named `e2e-<run id>-<...>`
  (`e2e/testAccount.js`), so two Stage 2 jobs can't collide and a
  cleanup can target exactly one run's rows.
- **Identity, not position.** Rows are addressed by
  `rule-row-…`/`rule-delete-button-…` testIDs built from the rule's own
  `match_value` (see `CategoryRulesPanel.tsx`), so an unexpected row can
  no longer misdirect a tap, and assertions say "this rule is gone"
  rather than "the list is empty".
- **`afterEach`, not end-of-test.** Cleanup that lives at the end of a
  test body is skipped by a failing assertion — which is how the first
  rule got orphaned. `afterEach` runs either way.

**Failures stay contained.** The nine `appFlows` tests share one app
session (a per-test reinstall costs more wall clock than every
interaction in the file combined), which used to mean whatever modal a
failing test died under was still covering the app for every test after
it — one bad assertion reported as nine red tests. `beforeEach` now
calls `ensureOnHome()` (`e2e/session.js`), a cheapest-first recovery
ladder: dismiss any open modal, else tap back to the Home tab, else
relaunch, else reinstall. `--retries 1` in the workflow then re-runs a
failed spec file once with a fresh device session — only safe because a
retry now starts from a known state, and deliberately just one, so a
single dropped tap doesn't gate a merge while a genuine failure still
goes red.

Two things here are only checkable at this stage, not at Stage 1:
**session persistence across a real relaunch** (`testLogin.test.js`)
exercises `lib/supabase.ts`'s actual encrypted-storage round-trip
(`LargeSecureStore`: an AES key in `SecureStore`, the encrypted session
blob in `AsyncStorage`) — Stage 1 mocks the whole `supabase` module at
the boundary, so a broken encrypt/decrypt round-trip is invisible there
(this exact bug class silently broke every real sign-in once before, see
that file's own comment). **Pull-to-refresh** (`appFlows.test.js`)
exercises a real swipe gesture against Home's `RefreshControl`; RN
doesn't preserve a custom `testID` on `RefreshControl` through
`ScrollView`'s native prop handling in Stage 1's JS test renderer, so
this could never be targeted there at all.

One thing this needed that earlier stages didn't: **`plugins/
withDetoxTestBuildType.js`** — an Expo config plugin that injects one
line (`testBuildType System.getProperty('testBuildType', 'debug')`) into
the prebuild-generated `android/app/build.gradle`. Bare React Native's
community template wires this up by default; Expo's prebuild template
doesn't, which was only discoverable by actually running `expo prebuild`
and inspecting the output — without it, the androidTest APK Detox builds
always targets the debug variant regardless of which app build type was
actually compiled, which would produce a mismatched APK pair.

**Real screenshots, from Detox's own artifact system.** `e2e/screenshot.js`'s
`captureScreen(name)` calls `device.takeScreenshot(name)` at key points
in each spec; since `detox test` now genuinely drives the device,
Detox's own artifact system relocates the result to `--artifacts-location`
(`e2e/artifacts/`, set in `mobile-detox.yml`) when the test completes —
no manual on-device file copying needed. The workflow's last step
uploads that whole directory as a `detox-results` GitHub Actions
artifact (`retention-days: 2`, since these are debugging aids for the
run that produced them, not something meant to be kept), fetchable
directly through the GitHub API. `--record-videos failing`/`--record-logs
failing` add a real screen recording and device log for any failing
test, without paying to record every passing run too. That's what lets a
UI change actually be verified visually, rather than only trusting that
a `toHaveText`/`toBeVisible` assertion passed.

**Stage 3 — the human-installable Android APK, built on the runner**
(`.github/workflows/mobile-build.yml`, manual-dispatch since a full
native build is the slowest thing in the pyramid): `npx expo prebuild
--platform android` generates `android/`, Gradle's `assembleRelease`
compiles it, and the resulting APK is uploaded as an
`android-apk-<profile>` GitHub Actions artifact (`retention-days: 14`)
— download it from the run's Artifacts section and sideload it onto a
phone. No EAS/Expo cloud build, no `EXPO_TOKEN`, no metered build
minutes, no third-party service: the same runner-local toolchain Stage 2
already drives, and the binary comes back attached to the run rather
than via a link on `expo.dev`.

Two things follow from building locally, both deliberate:

- **Android only.** GitHub's Linux runners can't build iOS at all — that
  needs macOS + Xcode, and a real-device iOS build additionally needs
  Apple Developer signing credentials. iOS stays an EAS job; see
  "Testing on a real iPhone (no Mac needed)" above.
- **The APK is signed with the standard Android debug keystore**, which
  is what Expo's prebuild template wires the `release` build type up to
  by default. It's a genuine release-mode binary (JS bundle baked in, no
  dev client, no Metro connection) and installs fine by sideloading — but
  it's not a Play Store upload. That needs a real upload key; see
  "Before shipping to a store" below.

The `profile` input picks what gets baked into the bundle, mirroring the
`eas.json` profiles it replaces: `preview` (default) enables test login
and the test Plaid Link path, `production` bakes in neither. `eas.json`
itself still exists for local/iOS `eas build` runs, but its `env` blocks
no longer feed this workflow — the equivalent values are set on the job
in `mobile-build.yml`, the same way `mobile-detox.yml` already does for
its Gradle build.

The build compiles **`arm64-v8a` only**, rather than the default four
ABIs — every extra ABI is a full extra native compile, and this step is
the bulk of the workflow's wall clock. That one covers every 64-bit
Android phone (at `minSdkVersion 26`, effectively all of them) plus
Apple Silicon emulators, which is exactly what this artifact is for.
`x86_64` used to be included so the APK would also run on a desktop
Intel emulator, but Stage 2 already tests on a real x86_64 emulator, so
it bought nothing. The trade-off, stated plainly: **this APK will not
install on an Intel/AMD Android emulator**, nor on a genuinely
32-bit-only device — add the ABI back to `-PreactNativeArchitectures` if
you need either.

(**`mobile/.npmrc`** — `legacy-peer-deps=true`, already committed — is
still what makes a plain `npm install` here resolve at all, and is what
EAS's own remote "Install dependencies" phase needs for any `eas build`
you still run for iOS. Without it that install fails with a real
`ERESOLVE` peer-dependency conflict on `react-test-renderer@19.2.8`'s
peer `react` requirement, surfaced only as a generic "Unknown error. See
logs of the Install dependencies build phase" until you go read the
build's log on `expo.dev`. This repo's own CI steps pass
`--legacy-peer-deps` explicitly instead.)

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
and Google's OAuth consent screen actively resists automation, so no
automated suite can drive a real sign-in. `supabase/functions/test-login`
is the way around that: it mints a real session for a designated dummy
account (`synthetic-monitor@scorecard.test`) without touching Google at
all.

- **Gated to non-production builds only.** `eas.json`'s `development`/
  `preview` profiles set `EXPO_PUBLIC_ENABLE_TEST_LOGIN=true`;
  `production` sets neither that nor the secret below, so the "Sign in as
  test user" link on the login screen (and the code behind it) is
  compiled out of any build a real user would install.
- **The secret itself is not committed.** `EXPO_PUBLIC_TEST_LOGIN_SECRET`
  comes from a GitHub repository secret of the same name (see
  `mobile-detox.yml` / `mobile-build.yml`), and from `eas secret:create`
  for EAS builds. It used to be a literal in `eas.json` and in both
  workflows, on the argument that it can only ever act on one dummy
  account -- true, but this repository is public, so it was also
  world-readable, and anyone could mint a session for that account. Note
  the value is still inlined into the app bundle at build time (that is
  what `EXPO_PUBLIC_` means) and is extractable from any installed
  build; keeping it out of git is a narrower goal than keeping it
  secret, and the only achievable one.
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
- **Cleaned up when the run ends** (`e2e/globalTeardown.js`). The Edge
  Function has always cleaned up at the *start* of a run, so
  duplicate-account detection doesn't trip on a relink — but that left
  the last run's Sandbox item in the project indefinitely, and that is
  not merely untidy. A Sandbox item's `access_token` was minted by the
  Sandbox client, while the hourly `plaid-balance-refresh` cron uses the
  **Production** client; the two environments don't interoperate, so a
  leftover item can never refresh and fails that cron on every tick,
  forever. It fails invisibly, too: the `cron.job_run_details` row reads
  `succeeded` (pg_net only queues the request), the HTTP status is 200,
  and the failure appears only as a count inside a JSON response body.
  This was happening in production before the teardown existed. The
  teardown signs in via `test-login`, calls `test-plaid-link` with
  `{"action": "cleanup"}`, and is deliberately non-fatal — a cleanup
  failure logs loudly rather than reddening an otherwise-green run, and
  the start-of-run cleanup remains the safety net for a run that never
  reaches teardown (a cancelled job, a crashed emulator).
- **Gated twice.** A shared secret (`TEST_PLAID_LINK_SECRET`, matching
  the Edge Function secret of the same name, independently rotatable
  from the test-login secret) *and* a server-side check that the caller
  **is** the dummy account, `synthetic-monitor@scorecard.test`. The
  second gate is what makes "a leaked secret can only ever affect the
  dummy account" true. Without it the function wrote to whatever
  `user_id` the JWT carried, and it was reachable from the app: see
  "Why the app has no test-bank button" below.
- **Read only by Detox's host process.** The secret is `TEST_PLAID_LINK_SECRET`
  in CI, deliberately *not* `EXPO_PUBLIC_`-prefixed -- anything with that
  prefix is inlined into the app bundle and extractable from any
  installed build. (The GitHub repository secret keeps its older
  `EXPO_PUBLIC_`-prefixed name; `mobile-detox.yml` maps it onto the new
  variable.)
- **Idempotent.** Before linking, it disconnects the Sandbox items *it*
  previously seeded -- scoped to `ins_109508`, never "every active item"
  -- mirroring `plaid-disconnect`'s logic against the sandbox client, so
  Items are properly revoked at Plaid too. Plaid's Sandbox test data
  (including account/routing numbers) is deterministic per institution,
  so without this a second CI run would look like the exact same real
  account relinking, and the duplicate-account detection below would
  reject it.
- **Seeded data gets no retention grace.** A real disconnect records the
  accounts in `plaid_disconnected_accounts` and lets the 90-day purge job
  delete the history later, which is right for a real user's real
  transactions and wrong for synthetic ones: it turns "remove the test
  data" into "remove it next quarter". Disconnecting a seeded Sandbox
  item deletes its transactions and fingerprints outright.
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
- **Called by the test, not by the app.** `e2e/testAccount.js`'s
  `seedSandboxBank()` calls the function over HTTP from Detox's own host
  process, before the app launches; the spec then signs in and waits for
  the linked account to show up in the Banks block.

### Why the app has no test-bank button

It used to. `components/AccountBalances.tsx` rendered a flask icon next
to "Add bank" whenever `EXPO_PUBLIC_ENABLE_TEST_LOGIN` was set — which
the `preview` EAS profile sets, so it shipped in the build installed on
a real phone, one tap from the real balances, with no confirmation. And
`test-plaid-link` acted on whatever session called it, not on the dummy
account its own comments claimed. Tapping it while signed in as a real
user therefore:

- seeded twelve Sandbox accounts and their fixture transactions into
  that real account, and
- **disconnected the real bank first**, because the pre-seed cleanup
  removed *every* active item rather than only what it had seeded. The
  `itemRemove` call then failed silently (a Production access token
  against the Sandbox client), so the Item stayed live at Plaid while
  the app dropped its token — recoverable only by relinking through
  Plaid Link.

None of it could be undone from the app: the state is server-side, so
signing out and back in changes nothing, and the seeded transactions sat
on the 90-day retention clock rather than going away.

Removing the button is only part of the fix — the two server-side gates
above are what make the same call unreachable from any client. What the
button bought was never real coverage: the exchange and every DB write
happen inside the Edge Function, so a tap proved nothing that seeding
from the host doesn't. If anything the specs now test more, since the app
renders a linked account it did not create, exactly as a real user's app
does after a real Plaid Link. `AccountBalances.test.tsx` keeps a
regression test asserting no such control renders, in any build.

## Before shipping to a store

- `app.json`'s `ios.bundleIdentifier` / `android.package` are placeholders
  (`com.fathom.app`) — change these to your own before running a store build.
- You'll need an Apple Developer Program account (iOS, $99/yr) and Google
  Play Console account (Android, $25 one-time) to actually submit.
- **Stage 3's APK can't be uploaded to Play as-is.** It's signed with the
  standard Android debug keystore (Expo's prebuild default for the
  `release` build type). A store build needs a real upload key: either
  let EAS manage credentials (`eas build --profile production --platform
  android`), or generate a keystore yourself and wire a `release`
  `signingConfig` into `android/app/build.gradle` — which, since
  `android/` is generated by prebuild and not committed, means doing it
  from a config plugin the way `plugins/withDetox*.js` do.
- `eas.json` has `development`/`preview`/`production` build profiles
  scaffolded; none have been run from this sandbox (no EAS account
  configured here). Stage 3 no longer uses them — only iOS and store
  builds still go through EAS.
- Supabase Auth's **Redirect URLs** allowlist (Dashboard → Authentication →
  URL Configuration) needs `fathom://*` added, or `signInWithGoogle()`'s
  callback (`lib/AuthProvider.tsx`) falls back to the project's Site URL
  instead of bouncing back into the app via the deep link — from the
  outside this looks like the sign-in flow stranding you in the system
  browser instead of returning to native screens.
