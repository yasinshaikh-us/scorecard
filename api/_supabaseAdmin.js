// Service-role Supabase client for server-side code that must write
// across RLS (e.g. storing Plaid access tokens on a user's behalf during
// the exchange step, before/without their own request forwarding a
// session token for that specific table). Only import this from code
// that has already authenticated the caller itself — it bypasses RLS
// entirely, unlike the rest of this app's api/*.js handlers, which
// forward the caller's own access token and let RLS restrict access.
//
// SUPABASE_SERVICE_ROLE_KEY is set in Vercel's Project Settings ->
// Environment Variables. Never prefix it VITE_ — it must never ship to
// the browser bundle.

import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const err = new Error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on the server.");
    err.status = 500;
    throw err;
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
