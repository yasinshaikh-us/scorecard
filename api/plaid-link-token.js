// Vercel serverless function.
// Creates a Plaid Link token for the signed-in user so the client can
// launch the Link flow. Requires PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV
// (see api/_plaid.js) to be set in Vercel's Environment Variables.

import { CountryCode, Products } from "plaid";
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
      client_name: "Analysis",
      products: [Products.Transactions, Products.Auth],
      // Balance isn't a Link product — it's fetched on demand for
      // already-linked accounts, so it doesn't go in this list.
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: WEBHOOK_URL,
    });

    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
