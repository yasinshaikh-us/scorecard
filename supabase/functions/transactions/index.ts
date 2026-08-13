// Edge Function. Called by the Expo app in mobile/ (see mobile/lib/).
// verify_jwt is enabled (the platform default) -- the gateway already
// rejects a request with no valid Supabase JWT on Authorization before
// this code runs; requireUser() recovers *which* user it belongs to.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { fetchAllRows, fetchAccountLabels, toClientRows } from "../_shared/transactionsData.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_URL / SUPABASE_ANON_KEY are not set." }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);

    const [rawRows, labels] = await Promise.all([
      fetchAllRows(url, anonKey, user.accessToken),
      fetchAccountLabels(url, anonKey, user.accessToken),
    ]);

    return new Response(JSON.stringify(toClientRows(rawRows, labels)), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || 500;
    return new Response(JSON.stringify({ error: err.body || String(err.message || err) }), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
