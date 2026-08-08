// Fetch/shape helpers for the ledger data, shared by the `transactions`
// and `query` Edge Functions. Pure fetch + parameters -- no Deno.env or
// npm: imports here -- so this stays runnable (and unit-testable) under
// both Deno and plain Node/Vitest.
//
// This forwards the caller's own Supabase access token straight through
// to PostgREST, rather than using the service-role key -- that's what
// makes `transactions`' `auth.uid() = user_id` RLS policy the thing
// actually restricting each request to its own rows, instead of app code
// doing it.
//
// Supabase's Data API caps every request at a project-configured "Max Rows"
// value (1000 by default) no matter what `limit` we ask for, so a single
// request silently truncates once the table grows past that. We page
// through with the Range header instead, so this keeps working regardless
// of how large the table gets or what that project setting is.

const PAGE_SIZE = 1000;

export async function fetchAllRows(url: string, anonKey: string, accessToken: string) {
  const rows: any[] = [];
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
      const err: any = new Error("Supabase request failed");
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
export async function fetchAccountLabels(url: string, anonKey: string, accessToken: string) {
  const resp = await fetch(`${url}/rest/v1/plaid_accounts?select=account_id,name,mask`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rows = await resp.json();

  if (!resp.ok) {
    const err: any = new Error("Supabase request failed");
    err.status = resp.status;
    err.body = rows;
    throw err;
  }

  const labels: Record<string, string> = {};
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

// Calls the ledger_meta() Postgres RPC instead of downloading every
// column of every row just to compute a handful of scalars. Used by the
// `query` function to build its NL-query system prompt without paying
// for a full-ledger fetch on every question asked. SECURITY INVOKER and
// scoped to auth.uid() internally (no parameters), same RLS-respecting
// pattern as every other request in this file -- the caller's own access
// token goes on Authorization, never a service-role key.
export async function fetchLedgerMeta(url: string, anonKey: string, accessToken: string) {
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
    const err: any = new Error("Supabase request failed");
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
// unlinked between the transactions fetch and the accounts fetch) -- it
// falls back to a generic label instead.
export function accountLabelFor(row: any, labels: Record<string, string>) {
  if (!row.plaid_account_id) return "Manual entry";
  return labels[row.plaid_account_id] || "Linked account";
}

// Shared by `transactions` and `query`, so the {Id, Date, Payee, Category,
// Amount, Account, IsTransfer} shape served to the client and the shape
// the NL query system prompt is built from can't drift apart. Id is the
// transactions.id primary key -- needed so the client can edit a specific
// row directly rather than only through category_rules.
export function toClientRows(rawRows: any[], labels: Record<string, string>) {
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
