import { createClient } from "@supabase/supabase-js";

// Browser-side Supabase client (anon/publishable key — safe to expose,
// same rationale as MAPBOX_TOKEN in the location app). Session persists
// in localStorage and refreshes automatically; the access token is what
// api/transactions.js forwards to PostgREST so its `auth.uid() = user_id`
// RLS policy can do the actual per-user filtering.
let client;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  }
  return client;
}
