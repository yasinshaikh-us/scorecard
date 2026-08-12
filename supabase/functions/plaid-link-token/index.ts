// Edge Function, replaces the old Vercel api/plaid-link-token.js.
// Creates a Plaid Link token for the signed-in user so the client can
// launch the Link flow. PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV are
// set as Supabase Edge Function secrets (see ../_shared/plaid.ts).

import { CountryCode, Products, DepositoryAccountSubtype } from "npm:plaid@45";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { plaidClient } from "../_shared/plaid.ts";

// Registered per Item at Link token creation; Plaid then calls this URL
// for every Item the resulting Link session creates. See
// supabase/functions/plaid-webhook.
const WEBHOOK_URL = "https://bidorjtgbhuihppsznkc.supabase.co/functions/v1/plaid-webhook";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);
    const client = plaidClient();

    const response = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "fa/thm",
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
      // option in the first place.
      account_filters: {
        depository: {
          account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings],
        },
      },
      // Without this, Plaid's initial historical sync for a new Item
      // defaults to just 90 days -- fine for a first link, but it means a
      // relink after a longer disconnect gap wouldn't reach far enough
      // back to actually backfill the gap. 730 is Plaid's max
      // (institution-dependent). Fixed per-Item once Transactions is
      // added -- can't be changed later without a full relink.
      transactions: {
        days_requested: 730,
      },
    });

    return new Response(JSON.stringify({ link_token: response.data.link_token }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || err.response?.status || 500;
    return new Response(JSON.stringify({ error: err.response?.data || String(err.message || err) }), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
