// The cooldown plaid-balance-refresh-user applies before spending a
// Plaid Balance call. Lives here, not in that function's index.ts, for
// the same reason syncItemTransactions.ts does: index.ts calls
// Deno.serve at module scope and so cannot be loaded by the Node/Vitest
// suite at all. Anything with a decision in it belongs on this side of
// that line.
//
// The signal is plaid_account_balances.as_of, which every writer of a
// balance stamps -- the hourly cron, a transaction webhook, and this
// function alike. So "how old is the freshest balance we hold for this
// user" is an exact answer to "would asking Plaid again tell us anything
// new", with no extra bookkeeping table to keep in step.

// Long enough that a user bouncing between Home and Ask, or tugging the
// list twice, costs one Plaid call rather than five. Short enough that a
// deliberate pull-to-refresh a minute after the last one is honoured --
// the gesture means "I want the current number" and should get it.
export const BALANCE_COOLDOWN_SECONDS = 60;

// Returns the seconds still to wait, or 0 to go ahead and call Plaid.
export function cooldownRemaining(
  freshestAsOf: string | null | undefined,
  now: number,
  cooldownSeconds: number = BALANCE_COOLDOWN_SECONDS
): number {
  // No stored balance at all -- a freshly linked account, or one whose
  // first refresh has not landed. Nothing to be fresh, so refresh.
  if (!freshestAsOf) return 0;

  const ageSeconds = (now - new Date(freshestAsOf).getTime()) / 1000;

  // An unparseable timestamp, or one in the future (clock skew between
  // Postgres and the Edge Function runtime), must not lock refreshes out
  // for however long the skew lasts. Both mean "no idea how old this
  // is", and the safe reading of that is to go and find out.
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 0;

  return Math.max(0, Math.ceil(cooldownSeconds - ageSeconds));
}
