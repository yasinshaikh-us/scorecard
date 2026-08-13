// Shared CORS headers for the user-facing Edge Functions (transactions,
// plaid-link-token, plaid-exchange, plaid-disconnect, query). These are
// called cross-origin by clients, unlike plaid-webhook/plaid-balance-
// refresh, which are only ever called server-to-server. Every function
// using this must handle its own OPTIONS preflight -- verify_jwt (enabled
// by default for these five) would otherwise reject the preflight request
// itself, since a preflight carries no Authorization header.
//
// React Native's fetch doesn't send preflights the way a browser does, so
// the mobile app never exercises the OPTIONS path -- these headers are
// kept anyway: they cost nothing, and removing the preflight handling
// would silently break any future browser-based client (or a local
// browser-based debugging tool) pointed at these functions.
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
