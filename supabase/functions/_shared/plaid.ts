// Shared Plaid client for Edge Functions. PLAID_CLIENT_ID / PLAID_SECRET /
// PLAID_ENV are set as Supabase Edge Function secrets (Project Settings ->
// Edge Functions -> Secrets, or `supabase secrets set`) — separate from
// the same-named vars on Vercel, since these two platforms don't share
// an environment.

import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@45";

export function plaidClient() {
  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  const env = Deno.env.get("PLAID_ENV") || "sandbox";

  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not set as Edge Function secrets.");
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
