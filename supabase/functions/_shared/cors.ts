// Shared CORS headers for the user-facing Edge Functions (transactions,
// plaid-link-token, plaid-exchange, plaid-disconnect, query). These are
// called cross-origin from the browser SPA (a different origin than the
// Supabase project URL), unlike plaid-webhook/plaid-balance-refresh,
// which are never called from a browser. Every function using this must
// handle its own OPTIONS preflight -- verify_jwt (enabled by default for
// these five) would otherwise reject the preflight request itself, since
// browsers send it without an Authorization header.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
