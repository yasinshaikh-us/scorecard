// Vercel serverless function.
// Exchanges a Plaid Link public_token for a permanent access_token, then
// stores the item/accounts/auth-numbers server-side via the service-role
// key. The access_token and account/routing numbers never round-trip
// back to the client — only a non-sensitive summary does.
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
import { CountryCode } from "plaid";
import { plaidClient, requireUser } from "./_plaid.js";
import { supabaseAdmin } from "./_supabaseAdmin.js";

async function fetchAuthNumbers(client, accessToken, itemId) {
  // Best-effort: not every institution/account supports Auth. Returns a
  // map of account_id -> { account_number, routing_number }.
  try {
    const authResp = await client.authGet({ access_token: accessToken });
    const byAccountId = {};
    for (const n of authResp.data.numbers.ach || []) {
      byAccountId[n.account_id] = { account_number: n.account, routing_number: n.routing, wire_routing_number: n.wire_routing || null };
    }
    return byAccountId;
  } catch (authErr) {
    console.error("Plaid auth/get failed for item", itemId, authErr);
    return {};
  }
}

// Pure decision logic, split out so it's unit-testable without mocking
// the Plaid SDK or Supabase. `existingAccounts` is this user's currently
// active plaid_accounts rows (each with its item's institution_id
// attached); `existingAuthByAccountId` is their known account/routing
// numbers, keyed by account_id. `newAuthByAccountId` is the same for the
// Item just being linked.
export function partitionDuplicateAccounts({ accounts, institutionId, newAuthByAccountId, existingAccounts, existingAuthByAccountId }) {
  const existingNumberPairs = new Set(
    Object.values(existingAuthByAccountId).map((n) => `${n.account_number}|${n.routing_number}`)
  );
  const existingFallbackKeys = new Set(
    existingAccounts.map((a) => `${a.plaid_items.institution_id}|${a.mask}|${a.type}|${a.subtype}`)
  );

  function isDuplicate(account) {
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const publicToken = req.body?.public_token;
  if (!publicToken) {
    res.status(400).json({ error: "public_token is required" });
    return;
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();
    const db = supabaseAdmin();

    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const itemInfo = await client.itemGet({ access_token: accessToken });
    const institutionId = itemInfo.data.item.institution_id || null;

    // Best-effort: a naming lookup failing shouldn't abort a link that
    // already succeeded at Plaid -- that would leave the Item live and
    // unrevoked with no local record of it at all.
    let institutionName = null;
    if (institutionId) {
      try {
        const institution = await client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = institution.data.institution.name;
      } catch (nameErr) {
        console.error("Plaid institutionsGetById failed for item", itemId, nameErr);
      }
    }

    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsResp.data.accounts;

    const newAuthByAccountId = await fetchAuthNumbers(client, accessToken, itemId);

    // The user's currently-connected accounts to dedup against. Scoped to
    // active items only, so an account that was properly disconnected
    // (see api/plaid-disconnect.js) can always be relinked.
    const { data: existingAccounts, error: existingError } = await db
      .from("plaid_accounts")
      .select("account_id, mask, type, subtype, plaid_items!inner(institution_id, status)")
      .eq("user_id", user.id)
      .eq("plaid_items.status", "active");
    if (existingError) throw existingError;

    const existingAccountIds = (existingAccounts || []).map((a) => a.account_id);
    let existingAuthByAccountId = {};
    if (existingAccountIds.length > 0) {
      const { data: existingAuth, error: existingAuthError } = await db
        .from("plaid_auth_numbers")
        .select("account_id, account_number, routing_number")
        .in("account_id", existingAccountIds);
      if (existingAuthError) throw existingAuthError;
      for (const a of existingAuth || []) existingAuthByAccountId[a.account_id] = a;
    }

    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts,
      institutionId,
      newAuthByAccountId,
      existingAccounts: existingAccounts || [],
      existingAuthByAccountId,
    });
    const duplicateCount = duplicateAccounts.length;

    if (newAccounts.length === 0) {
      // Every account in this Item is one the user already has connected
      // -- there's nothing new to keep, so revoke it at Plaid rather than
      // leaving an unused duplicate Item connected.
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (removeErr) {
        console.error("Failed to revoke duplicate item", itemId, removeErr);
      }
      res.status(409).json({
        error: `${institutionName || "This account"} is already connected. Disconnect it first if you need to relink it.`,
      });
      return;
    }

    let plaidItem;
    try {
      const { data, error: itemInsertError } = await db
        .from("plaid_items")
        .insert({
          user_id: user.id,
          item_id: itemId,
          access_token: accessToken,
          institution_id: institutionId,
          institution_name: institutionName,
        })
        .select()
        .single();
      if (itemInsertError) throw itemInsertError;
      plaidItem = data;

      const { error: accountsInsertError } = await db.from("plaid_accounts").insert(
        newAccounts.map((a) => ({
          item_id: plaidItem.id,
          user_id: user.id,
          account_id: a.account_id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
        }))
      );
      if (accountsInsertError) throw accountsInsertError;

      const authRows = newAccounts
        .filter((a) => newAuthByAccountId[a.account_id])
        .map((a) => ({
          account_id: a.account_id,
          user_id: user.id,
          account_number: newAuthByAccountId[a.account_id].account_number,
          routing_number: newAuthByAccountId[a.account_id].routing_number,
          wire_routing_number: newAuthByAccountId[a.account_id].wire_routing_number,
        }));
      if (authRows.length > 0) {
        const { error: authInsertError } = await db.from("plaid_auth_numbers").insert(authRows);
        if (authInsertError) throw authInsertError;
      }
    } catch (writeErr) {
      // Partial failure -- don't leave a zombie plaid_items row (a live,
      // unlinked access token) behind. Best-effort cleanup, then surface
      // the original error.
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (removeErr) {
        console.error("Failed to revoke item after partial write failure", itemId, removeErr);
      }
      if (plaidItem) {
        await db.from("plaid_items").delete().eq("id", plaidItem.id);
      }
      throw writeErr;
    }

    res.status(200).json({
      institution_name: institutionName,
      accounts: newAccounts.map((a) => ({ name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
      skipped_duplicate_accounts: duplicateCount,
    });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
