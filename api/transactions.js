// Vercel serverless function.
// Runs server-side only — this is where your Supabase service-role key
// actually lives. The browser never sees it. Set SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in your Vercel project's Environment Variables
// (Project Settings -> Environment Variables), not here.
//
// SUPABASE_SERVICE_ROLE_KEY accepts either Supabase key format: the legacy
// service_role JWT, or the newer sb_secret_... key. Only send it on the
// apikey header — the newer format isn't a JWT and gets rejected if also
// sent as an Authorization: Bearer token.
//
// Row Level Security is enabled on the `transactions` table with no
// policies, so the anon/publishable key has zero access — only the
// service-role key (used here, server-side only) can read it.
//
// Supabase's Data API caps every request at a project-configured "Max Rows"
// value (1000 by default) no matter what `limit` we ask for, so a single
// request silently truncates once the table grows past that. We page
// through with the Range header instead, so this keeps working regardless
// of how large the table gets or what that project setting is.

const PAGE_SIZE = 1000;

export async function fetchAllRows(url, serviceKey) {
  const rows = [];
  let from = 0;

  while (true) {
    const resp = await fetch(
      `${url}/rest/v1/transactions?select=date,payee,category,amount&order=date.asc`,
      {
        headers: {
          apikey: serviceKey,
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

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on the server." });
    return;
  }

  try {
    const rows = await fetchAllRows(url, serviceKey);

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
