// Vercel serverless function.
// Creates a Plaid Link token for the signed-in user so the client can
// launch the Link flow. Requires PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV
// (see api/_plaid.js) to be set in Vercel's Environment Variables.

import { CountryCode, Products, DepositoryAccountSubtype } from "plaid";
import { plaidClient, requireUser } from "./_plaid.js";

// Plaid's standard Transactions/Item webhooks aren't configured in the
// Plaid dashboard (that page is for separate products — Wallet, Transfer,
// Income). They're registered per Item by passing `webhook` here at Link
// token creation; Plaid then calls this URL for every Item the resulting
// Link session creates. See supabase/functions/plaid-webhook.
const WEBHOOK_URL = "https://bidorjtgbhuihppsznkc.supabase.co/functions/v1/plaid-webhook";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();

    const response = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Fathom",
      products: [Products.Transactions, Products.Auth],
      // Balance isn't a Link product — it's fetched on demand for
      // already-linked accounts, so it doesn't go in this list.
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: WEBHOOK_URL,
      // Transactions + Auth only support depository accounts (checking/
      // savings) -- without this, Plaid still lets a user select a
      // mortgage or brokerage account in Link's own account picker, and
      // it just silently produces nothing useful once selected. Omitting
      // the credit/loan/investment/other keys entirely (rather than
      // listing them empty) excludes those product types from Link
      // outright, so an unsupported account is never offered as an
      // option in the first place. If mortgage (Liabilities) or brokerage
      // (Investments) support is ever added, this needs to grow with it.
      account_filters: {
        depository: {
          account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings],
        },
      },
      // Without this, Plaid's initial historical sync for a new Item
      // defaults to just 90 days -- fine for a first link, but it means a
      // relink after a longer disconnect gap (see resync_after_date in
      // api/plaid-exchange.js) wouldn't reach far enough back to actually
      // backfill the gap, only to avoid duplicating whatever narrow window
      // it does cover. 730 is Plaid's max (institution-dependent; some
      // banks provide less regardless). Fixed per-Item once Transactions
      // is added -- can't be changed later without a full relink.
      transactions: {
        days_requested: 730,
      },
    });

    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
