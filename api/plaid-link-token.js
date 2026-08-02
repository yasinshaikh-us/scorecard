// Vercel serverless function.
// Creates a Plaid Link token for the signed-in user so the client can
// launch the Link flow. Requires PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV
// (see api/_plaid.js) to be set in Vercel's Environment Variables.

import { CountryCode, Products } from "plaid";
import { plaidClient, requireUser } from "./_plaid.js";

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
      client_name: "Ledger",
      products: [Products.Transactions, Products.Auth],
      // Balance isn't a Link product — it's fetched on demand for
      // already-linked accounts, so it doesn't go in this list.
      country_codes: [CountryCode.Us],
      language: "en",
    });

    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || String(err.message || err) });
  }
}
