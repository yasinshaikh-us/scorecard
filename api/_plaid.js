// Shared helpers for the Plaid Vercel endpoints. Server-side only.
//
// PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV are set in Vercel's Project
// Settings -> Environment Variables (never VITE_-prefixed — they must
// never reach the browser bundle).

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

export function plaidClient() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || "sandbox";

  if (!clientId || !secret) {
    const err = new Error("PLAID_CLIENT_ID / PLAID_SECRET are not set on the server.");
    err.status = 500;
    throw err;
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

// middleware.js already rejects requests with no valid Supabase session
// before they reach these handlers; this just recovers the caller's user
// id the same way middleware validated the token (asking Supabase's Auth
// API), so each handler knows *which* user it's acting for.
export async function requireUser(req) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const err = new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set on the server.");
    err.status = 500;
    throw err;
  }

  const accessToken = (req.headers.authorization || "").match(/^Bearer (.+)$/i)?.[1];
  if (!accessToken) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const user = await resp.json();
  return { id: user.id, accessToken };
}
