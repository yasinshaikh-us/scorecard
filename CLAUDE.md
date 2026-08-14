# CLAUDE.md

Standing instructions for Claude Code sessions in this repository.
Durable authorizations — they apply across sessions without being
re-granted.

## Response style

Terse. Lead with the result, not the process.

- No preamble, no restating the request, no summarizing what was just
  said. Answer, then stop.
- Prose only where it carries meaning. Tables and short lists over
  paragraphs.
- Don't narrate routine tool use ("let me check X", "now I'll run Y").
  Just do it and report what came back.
- Report failures and uncertainty plainly and immediately — brevity
  never means omitting a blocker, a caveat, or a wrong result.
- Long output is fine when the content genuinely needs it: a design
  review, a diagnosis with evidence, a decision with real trade-offs.
  Length should track substance, not effort.

## Blanket authorization

Claude acts without asking for confirmation across normal operations on
this project. Specifically and non-exhaustively:

**GitHub** — read anything; create/update/merge/close PRs; comment and
review; create branches; push; trigger, re-run and cancel workflows;
read logs and download artifacts; manage PR subscriptions.

**Supabase** — read anything; `execute_sql`; `apply_migration`; deploy
Edge Functions; read logs and advisors; list/inspect projects, tables,
extensions, migrations; generate types; create/merge/rebase/reset
development branches.

**Local** — install dependencies; run any test, linter, typechecker or
build; run `expo`, `detox`, `vitest`, `jest`, `gradle`; read/write files
in the repo and scratchpad; git add/commit/push/checkout/cherry-pick;
`curl`; run scripts.

**Judgement calls** — pick the obvious option and say which was picked,
rather than asking. Ask only when different readings lead to materially
different work, or when proceeding would be unsafe.

## Still requires confirmation

Short list, everything else is covered above:

- Force-push, hard reset, or history rewrite on `main`
- Deleting branches, Supabase projects, or Supabase branches
- Pausing or restoring a Supabase project
- `execute_sql` that drops or truncates a table, or issues an unscoped
  `DELETE`/`UPDATE` against production data (this database holds real
  transaction history)
- Anything outward-facing to third parties — publishing to a store,
  emailing, posting outside this repo

## Merge authorization

Merge Claude's own PRs into `main` without asking, once ALL hold:

- Every required check is green: `ci.yml`'s `edge-function-tests`, plus —
  on any PR touching `mobile/` — `mobile-ci.yml`'s four jobs and
  `mobile-detox.yml`'s `detox-android`. Any CI added later counts too.
- The automated suite passes.
- Claude's own sanity check: tests covering what changed pass locally
  (`npm test` at root for Edge Functions, `npm test` in `mobile/` for the
  app), and the diff matches what the PR description claims.

Red, pending or missing check → don't merge. Report the blocker.

## Stage 2 (Detox) visual verification

A passing assertion proves an element exists, not that the screen renders
correctly. After any Stage 2 run tied to a UI change:

1. Confirm the "Run Detox tests on a real Android emulator" step itself
   succeeded, with a genuine nonzero test count — not an "OK (0 tests)"
   false positive (see `mobile/README.md`).
2. Download the `detox-results` artifact via the API. Don't ask the user
   to look.
3. Actually view the screenshots (the Read tool renders images).
4. State an explicit visual verdict before calling it done.

This has repeatedly caught defects that every assertion passed through —
content under the navigation bar, a Save button drawn on top of the
system recents button. It is the required last step, not a follow-up.

## CI cadence

Webhooks deliver CI *failures* reliably, not successes — catching green
needs polling. Stage 1 checks finish in under two minutes; poll about
once a minute after opening a PR. Stage 2 takes ~18 minutes.

No need to `subscribe_pr_activity` before acting on a PR. Check state
directly and act.

## Known traps in this repo

- **Detox's AVD snapshot cache was removed deliberately.** Restoring it
  intermittently boots the emulator into a state where the `input`
  service hasn't published, killing the step before any test runs. Don't
  reintroduce it to save the ~4 minutes.
- **`EXPO_PUBLIC_*` values are inlined into the app bundle** and are
  extractable from any installed build. They come from repository
  secrets; never commit one. This repo is public.
- **Stage 2 drives a shared real account** (`synthetic-monitor@…`) and one
  Plaid Sandbox item, which is why the workflow serializes runs. Two
  concurrent runs corrupt each other.
- **Reduce-motion is always on in CI**, so emulator screenshots exercise
  the static path of any animation. Motion can't be verified there.
