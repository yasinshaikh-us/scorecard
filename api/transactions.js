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
      `${url}/rest/v1/transactions?select=id,date,payee,category,amount,plaid_account_id,is_transfer&order=date.asc`,
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

// plaid_accounts is small (one row per linked account, not per
// transaction) so this is a single unpaged request. RLS on that table
// (`auth.uid() = user_id`) scopes it the same way `transactions` is
// scoped, via the caller's own access token.
export async function fetchAccountLabels(url, anonKey, accessToken) {
  const resp = await fetch(`${url}/rest/v1/plaid_accounts?select=account_id,name,mask`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rows = await resp.json();

  if (!resp.ok) {
    const err = new Error("Supabase request failed");
    err.status = resp.status;
    err.body = rows;
    throw err;
  }

  const labels = {};
  for (const r of rows) {
    if (!r.account_id) continue;
    // Plaid's mask is normally already 4 digits, but truncate defensively
    // so the label never surfaces more of the account number than the
    // last four digits, regardless of what an institution sends back.
    const mask = r.mask ? String(r.mask).slice(-4) : "";
    labels[r.account_id] = `${r.name || "Account"}${mask ? ` ••${mask}` : ""}`;
  }
  return labels;
}

// Calls the ledger_meta() Postgres RPC (see
// supabase/migrations/20260806030000_add_ledger_meta_function.sql)
// instead of downloading every column of every row just to compute a
// handful of scalars. Used by api/query.js to build its NL-query system
// prompt without paying for a full-ledger fetch on every question asked.
// SECURITY INVOKER and scoped to auth.uid() internally (no parameters),
// same RLS-respecting pattern as every other request in this file --
// the caller's own access token goes on Authorization, never a
// service-role key.
export async function fetchLedgerMeta(url, anonKey, accessToken) {
  const resp = await fetch(`${url}/rest/v1/rpc/ledger_meta`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const rows = await resp.json();

  if (!resp.ok) {
    const err = new Error("Supabase request failed");
    err.status = resp.status;
    err.body = rows;
    throw err;
  }

  // ledger_meta() is defined as RETURNS TABLE but always produces
  // exactly one row (a bare aggregate query, not a set) -- PostgREST
  // still wraps it as a one-element array.
  const row = rows[0] || {};
  return {
    categories: row.categories || [],
    subcategories: row.subcategories || [],
    minDate: row.min_date || "",
    maxDate: row.max_date || "",
    accountIds: row.distinct_account_ids || [],
    hasManual: !!row.has_manual,
  };
}

// A row with no plaid_account_id was entered manually, never linked to a
// bank account. A row with a plaid_account_id that isn't in `labels` is a
// data race, not an error to fail the request over (e.g. the account was
// unlinked between the transactions fetch and the accounts fetch) — it
// falls back to a generic label instead.
export function accountLabelFor(row, labels) {
  if (!row.plaid_account_id) return "Manual entry";
  return labels[row.plaid_account_id] || "Linked account";
}

// Shared by this handler and api/query.js, so the {Id, Date, Payee,
// Category, Amount, Account, IsTransfer} shape served to the client and
// the shape the NL query system prompt is built from can't drift apart.
// Id is the transactions.id primary key -- needed so the client can edit
// a specific row directly (see src/TransactionRow.jsx) rather than only
// through category_rules.
export function toClientRows(rawRows, labels) {
  return rawRows.map((r) => ({
    Id: r.id,
    Date: r.date,
    Payee: r.payee,
    Category: r.category,
    Amount: Number(r.amount),
    Account: accountLabelFor(r, labels),
    IsTransfer: !!r.is_transfer,
  }));
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
    const [rawRows, labels] = await Promise.all([
      fetchAllRows(url, anonKey, accessToken),
      fetchAccountLabels(url, anonKey, accessToken),
    ]);

    res.status(200).json(toClientRows(rawRows, labels));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.body || String(err.message || err) });
  }
}
