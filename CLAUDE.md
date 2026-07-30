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

## CI check-in cadence

GitHub webhooks reliably push CI *failures* into the conversation, but not
CI *success* — so catching the moment a PR goes green still requires
polling, not just waiting for a notification. This repo's CI pipeline
(build -> unit-tests -> smoke-test) typically finishes in well under two
minutes end-to-end, so poll roughly once a minute after opening a PR,
not every 8-10 minutes — merge as soon as the merge-authorization criteria
above are satisfied instead of leaving a green PR sitting unmerged for
several extra minutes.
