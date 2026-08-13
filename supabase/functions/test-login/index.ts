// Lets a non-production build (development/preview EAS profiles only)
// bootstrap a real, valid session for a designated dummy test account
// without driving Google's OAuth screen, which actively fights automated
// logins. mobile/e2e/*.test.js (Detox, Stage 2) calls this to get past
// the sign-in screen; the web app's Playwright suites used to inject a
// session the same way before that app was removed.
//
// Gated by a shared secret (TEST_LOGIN_SECRET, an Edge Function secret --
// deliberately separate from the account's real password, so leaking
// this can only ever mint a session for the one hardcoded test account
// below, never any real user, and it's independently rotatable without
// touching that account's actual login credentials). The mobile app only
// ever sends this secret from development/preview EAS builds (see
// mobile/eas.json) -- it's never baked into a production build.
//
// verify_jwt is off because the whole point is bootstrapping a session
// before one exists -- there's nothing to verify yet.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const TEST_ACCOUNT_EMAIL = "synthetic-monitor@scorecard.test";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const configuredSecret = Deno.env.get("TEST_LOGIN_SECRET");
  if (!configuredSecret) {
    return new Response(JSON.stringify({ error: "TEST_LOGIN_SECRET is not configured on this project." }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.secret !== "string" || body.secret !== configuredSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const db = supabaseAdmin();

    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: TEST_ACCOUNT_EMAIL,
    });
    if (linkError) throw linkError;

    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) throw new Error("generateLink didn't return a hashed_token");

    const { data: verifyData, error: verifyError } = await db.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (verifyError) throw verifyError;
    if (!verifyData.session) throw new Error("verifyOtp didn't return a session");

    return new Response(
      JSON.stringify({
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
