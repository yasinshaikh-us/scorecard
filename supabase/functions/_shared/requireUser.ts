// Recovers the caller's user id from their Supabase access token, by
// asking Supabase's Auth API whether it's still valid. Edge
// Functions get SUPABASE_URL and SUPABASE_ANON_KEY auto-injected by the
// platform, no manual secret needed for either.
//
// Each of these five functions has verify_jwt enabled (the platform
// default), so the gateway already rejects a request with no valid
// Supabase JWT on Authorization before it reaches this code -- this call
// is what recovers *which* user that JWT belongs to, not the first line
// of defense.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(req: Request): Promise<{ id: string; accessToken: string }> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new HttpError(500, "SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
  }

  const accessToken = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/i)?.[1];
  if (!accessToken) {
    throw new HttpError(401, "Unauthorized");
  }

  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new HttpError(401, "Unauthorized");
  }

  const user = await resp.json();
  return { id: user.id, accessToken };
}
