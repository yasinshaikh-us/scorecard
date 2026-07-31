// Vercel Routing Middleware — runs before every request to this project.
// Gates the `/api/*` routes behind a signed-in Supabase user; the static
// SPA shell (index.html, JS/CSS bundle) is public — it contains no
// secrets (the anon key it ships is safe to expose by design) and the
// app itself shows a sign-in screen when there's no session. Real data
// access is what's actually restricted: api/transactions.js forwards the
// caller's access token to PostgREST, so `transactions`' `auth.uid() =
// user_id` RLS policy is what does the per-user filtering.
//
// Unlike the old PIN gate (a self-issued HMAC-signed cookie, verified
// with no network call), this validates the caller's Supabase access
// token by asking Supabase's Auth API whether it's still valid — that's
// one extra round-trip per API request, but avoids reimplementing JWT
// verification (signature, expiry, revocation) ourselves.

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith("/api/")) {
    return; // static SPA shell — always public, see comment above
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.match(/^Bearer (.+)$/i)?.[1];

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });

  if (!userResp.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Valid session — let the request through. api/transactions.js still
  // needs the same Authorization header itself (to forward to
  // PostgREST), so it isn't stripped here.
}
