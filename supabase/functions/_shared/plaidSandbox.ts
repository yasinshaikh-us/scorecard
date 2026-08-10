// Dedicated Plaid Sandbox client for test-plaid-link only -- deliberately
// separate from plaid.ts's plaidClient(), which points at this project's
// real PLAID_CLIENT_ID/PLAID_SECRET/PLAID_ENV (Production -- a real
// linked bank account depends on it). Plaid's Sandbox and Production
// environments don't interoperate: a Sandbox-minted public_token/
// access_token can only ever be used against Plaid's Sandbox API, never
// Production. Hardcoding the basePath to PlaidEnvironments.sandbox (not
// reading PLAID_ENV at all) means this stays isolated from the real bank
// connection structurally, not by a runtime check on a shared value that
// could be misconfigured.

import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@45";

export function plaidSandboxClient() {
  const clientId = Deno.env.get("PLAID_SANDBOX_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SANDBOX_SECRET");

  if (!clientId || !secret) {
    throw new Error("PLAID_SANDBOX_CLIENT_ID / PLAID_SANDBOX_SECRET are not set as Edge Function secrets.");
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
