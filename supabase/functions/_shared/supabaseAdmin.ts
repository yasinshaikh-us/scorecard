// Service-role Supabase client for Edge Functions. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Supabase platform
// for every Edge Function — no manual secret needed for these two.

import { createClient } from "npm:@supabase/supabase-js@2";

export function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available in this Edge Function's environment.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
