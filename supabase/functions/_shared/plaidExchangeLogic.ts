// Pure duplicate-account logic for the `plaid-exchange` function, split
// out so it's unit-testable without mocking the Plaid SDK or Supabase.
// node:crypto's createHash works the same under Deno and Node/Vitest, so
// this file has no Deno-specific imports.
//
// Duplicate handling: Plaid mints a fresh account_id (and item_id) every
// time a bank is linked, even if it's the exact same real-world account
// the user already connected -- so nothing upstream stops a relink from
// creating a second copy. Account/routing numbers (from the Auth product)
// are the one identifier that stays stable for a real account across
// separate Items, so that's the primary signal used below to recognize
// "you already have this account." When Auth isn't available for an
// institution, this falls back to institution + mask + type/subtype,
// which is weaker (a coincidental collision is possible) but still far
// safer than not deduping at all. Dedup is per-account, not per-item, so
// linking a second, genuinely different account at a bank you're already
// connected to (e.g. adding a savings account after checking) works fine
// -- only accounts that actually match an existing one get skipped.

import { createHash } from "node:crypto";

// One-way fingerprint of a real account/routing number pair. Used to
// recognize "this relinked account is the same real account I had before"
// even after a full disconnect deletes plaid_auth_numbers. Deliberately
// not reversible: the fingerprints table is retained indefinitely (unlike
// plaid_auth_numbers), so it must never hold anything that could be
// turned back into a real account/routing number.
export function fingerprintFor(accountNumber: string, routingNumber: string) {
  return createHash("sha256").update(`${accountNumber}:${routingNumber}`).digest("hex");
}

// `existingAccounts` is this user's currently active plaid_accounts rows
// (each with its item's institution_id attached); `existingAuthByAccountId`
// is their known account/routing numbers, keyed by account_id.
// `newAuthByAccountId` is the same for the Item just being linked.
export function partitionDuplicateAccounts({
  accounts,
  institutionId,
  newAuthByAccountId,
  existingAccounts,
  existingAuthByAccountId,
}: {
  accounts: any[];
  institutionId: string | null;
  newAuthByAccountId: Record<string, { account_number: string; routing_number: string }>;
  existingAccounts: any[];
  existingAuthByAccountId: Record<string, { account_number: string; routing_number: string }>;
}) {
  const existingNumberPairs = new Set(
    Object.values(existingAuthByAccountId).map((n) => `${n.account_number}|${n.routing_number}`)
  );
  const existingFallbackKeys = new Set(
    existingAccounts.map((a) => `${a.plaid_items.institution_id}|${a.mask}|${a.type}|${a.subtype}`)
  );

  function isDuplicate(account: any) {
    const auth = newAuthByAccountId[account.account_id];
    if (auth) {
      return existingNumberPairs.has(`${auth.account_number}|${auth.routing_number}`);
    }
    return existingFallbackKeys.has(`${institutionId}|${account.mask}|${account.type}|${account.subtype}`);
  }

  const newAccounts = accounts.filter((a) => !isDuplicate(a));
  const duplicateAccounts = accounts.filter((a) => isDuplicate(a));
  return { newAccounts, duplicateAccounts };
}
