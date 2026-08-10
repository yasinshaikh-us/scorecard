# CLAUDE.md

Standing instructions for Claude Code sessions working in this repository.
These are durable authorizations — they apply across sessions without
needing to be re-granted each time.

## Merge authorization

Claude may merge its own pull requests into `main` without asking for
confirmation first, once ALL of the following hold:

- Every required status check on the PR is green. Today that means the
  Vercel deployment check succeeds (build passes); if a GitHub Actions
  workflow or other CI is added to this repo later, its checks count too.
- If the repo has an automated test suite at merge time, it passes.
- Claude has done its own sanity check on the change before merging:
  `npm run build` succeeds locally, and the diff actually matches what
  the PR description claims it does.

If any check is red, pending, or missing — don't merge. Report the
blocker instead and wait for direction.

This authorization covers the merge action itself. It does not cover
other destructive/hard-to-reverse git operations (force-push to `main`,
history rewrites, branch deletion, etc.) — those still need explicit
confirmation each time unless separately authorized here.

## No webhook subscription required

Claude does not need to call `subscribe_pr_activity` (or wait for
`<github-webhook-activity>` events) before checking on or acting on a PR
it owns. Check PR/CI state directly (e.g. `pull_request_read`) and act
once the merge criteria above are met — no need to subscribe to or wait
on GitHub webhook notifications first.

## Stage 2 (Detox/Firebase Test Lab) visual verification

Whenever a Stage 2 run (`mobile-detox.yml`) follows a UI/screen change,
passing Detox assertions is not the end of verification — a `toHaveText`/
`toBeVisible` assertion proves a specific value or element is present, not
that the screen actually renders/looks correct. Claude owns closing that
loop itself, not the user. Once the run completes:

1. Confirm the "Run Detox specs on Firebase Test Lab" step itself
   succeeded (not just that the job didn't error elsewhere).
2. Download the run's `firebase-test-lab-results` artifact via the GitHub
   API (list/download workflow run artifacts) — don't ask the user to
   open the Firebase console and look themselves.
3. Actually view the screenshots/video from it (the Read tool renders
   images) and check that the screen(s) the change touched look right.
4. State an explicit visual verdict in the reply — what was checked and
   whether it looks correct — before calling the change done. "Tests
   passed" alone is not a finished verification for a UI change.

This is the required last step of Stage 2 for any run tied to a UI
change, not an optional follow-up.

## CI check-in cadence

GitHub webhooks reliably push CI *failures* into the conversation, but not
CI *success* — so catching the moment a PR goes green still requires
polling, not just waiting for a notification. This repo's CI pipeline
(build -> unit-tests -> smoke-test) typically finishes in well under two
minutes end-to-end, so poll roughly once a minute after opening a PR,
not every 8-10 minutes — merge as soon as the merge-authorization criteria
above are satisfied instead of leaving a green PR sitting unmerged for
several extra minutes.
