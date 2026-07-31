// Vercel serverless function.
// Runs server-side only. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// in your Vercel project's Environment Variables (Project Settings ->
// Environment Variables), not here. Same two vars the browser bundle
// uses (see src/supabaseClient.js) — deliberately one shared pair rather
// than a separate server-only SUPABASE_URL, so there's only one place to
// configure and no chance of the two drifting apart.
//
// This forwards the caller's own Supabase access token (the Authorization
// header middleware.js already validated) straight through to PostgREST,
// rather than using the service-role key — that's what makes
// `transactions`' `auth.uid() = user_id` RLS policy the thing actually
// restricting each request to its own rows, instead of app code doing it.
// The service-role key never appears in this file.
//
// Supabase's Data API caps every request at a project-configured "Max Rows"
// value (1000 by default) no matter what `limit` we ask for, so a single
// request silently truncates once the table grows past that. We page
// through with the Range header instead, so this keeps working regardless
// of how large the table gets or what that project setting is.

const PAGE_SIZE = 1000;

export async function fetchAllRows(url, anonKey, accessToken) {
  const rows = [];
  let from = 0;

  while (true) {
    const resp = await fetch(
      `${url}/rest/v1/transactions?select=date,payee,category,amount&order=date.asc`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          Range: `${from}-${from + PAGE_SIZE - 1}`,
        },
      }
    );

    const page = await resp.json();

    if (!resp.ok) {
      const err = new Error("Supabase request failed");
      err.status = resp.status;
      err.body = page;
      throw err;
    }

    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    res.status(500).json({ error: "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set on the server." });
    return;
  }

  const accessToken = (req.headers.authorization || "").match(/^Bearer (.+)$/i)?.[1];
  if (!accessToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const rows = await fetchAllRows(url, anonKey, accessToken);

    const data = rows.map((r) => ({
      Date: r.date,
      Payee: r.payee,
      Category: r.category,
      Amount: Number(r.amount),
    }));

    res.status(200).json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.body || String(err.message || err) });
  }
}
