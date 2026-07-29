// Vercel serverless function.
// Runs server-side only — this is where your Supabase service-role key
// actually lives. The browser never sees it. Set SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in your Vercel project's Environment Variables
// (Project Settings -> Environment Variables), not here.
//
// Row Level Security is enabled on the `transactions` table with no
// policies, so the anon/publishable key has zero access — only the
// service-role key (used here, server-side only) can read it.

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
    const supabaseResp = await fetch(
      `${url}/rest/v1/transactions?select=date,payee,category,amount&order=date.asc&limit=20000`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    const rows = await supabaseResp.json();

    if (!supabaseResp.ok) {
      res.status(supabaseResp.status).json({ error: rows });
      return;
    }

    const data = rows.map((r) => ({
      Date: r.date,
      Payee: r.payee,
      Category: r.category,
      Amount: Number(r.amount),
    }));

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
