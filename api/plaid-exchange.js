// Vercel serverless function.
// Exchanges a Plaid Link public_token for a permanent access_token, then
// stores the item/accounts/auth-numbers server-side via the service-role
// key. The access_token and account/routing numbers never round-trip
// back to the client — only a non-sensitive summary does.

import { CountryCode } from "plaid";
import { plaidClient, requireUser } from "./_plaid.js";
import { supabaseAdmin } from "./_supabaseAdmin.js";

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

    let institutionName = null;
    if (institutionId) {
      const institution = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = institution.data.institution.name;
    }

    // Plaid scopes account_id per Item, so relinking a bank you've
    // already connected doesn't get deduped upstream -- it silently
    // produces a second Item with new account_ids for the same
    // real-world accounts (duplicate balances/transactions). Block it
    // here instead, and revoke the Item we just created rather than
    // leaving an unused duplicate connected at Plaid.
    if (institutionId) {
      const { data: existing } = await db
        .from("plaid_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("institution_id", institutionId)
        .eq("status", "active")
        .limit(1);

      if (existing && existing.length > 0) {
        try {
          await client.itemRemove({ access_token: accessToken });
        } catch (removeErr) {
          console.error("Failed to revoke duplicate item", itemId, removeErr);
        }
        res.status(409).json({
          error: `${institutionName || "This bank"} is already connected. Disconnect it first if you need to relink it.`,
        });
        return;
      }
    }

    const { data: plaidItem, error: itemInsertError } = await db
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

    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsResp.data.accounts;

    const { error: accountsInsertError } = await db.from("plaid_accounts").insert(
      accounts.map((a) => ({
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

    // Auth (account/routing numbers) isn't available for every
    // institution/account — best-effort, don't fail the whole link if
    // it's unavailable.
    try {
      const authResp = await client.authGet({ access_token: accessToken });
      const numbers = authResp.data.numbers.ach || [];

      if (numbers.length > 0) {
        const { error: authInsertError } = await db.from("plaid_auth_numbers").insert(
          numbers.map((n) => ({
            account_id: n.account_id,
            user_id: user.id,
            account_number: n.account,
            routing_number: n.routing,
            wire_routing_number: n.wire_routing || null,
          }))
        );
        if (authInsertError) throw authInsertError;
      }
    } catch (authErr) {
      console.error("Plaid auth/get failed for item", itemId, authErr);
    }

    res.status(200).json({
      institution_name: institutionName,
      accounts: accounts.map((a) => ({ name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
    });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
