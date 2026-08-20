// Edge Function. Seeds (and clears) the ledger Stage 2 asks its questions
// against, on the one dummy account, with the service role.
//
// WHY A FUNCTION AND NOT A DIRECT WRITE
//
// mobile/e2e/globalSetup.js first tried to POST these rows straight to
// PostgREST with the dummy account's own JWT. That fails with 42501, and
// correctly so: `transactions` carries a SELECT policy and an UPDATE
// policy for a signed-in user, and nothing else. A client can read its
// rows and edit the ones it has; it cannot fabricate new ones. Every
// real write to that table comes from an Edge Function holding the
// service role (the Plaid sync path), which is the right shape for a
// ledger -- rows should come from a bank, not from whoever holds an
// anon key and an account.
//
// Adding an INSERT policy to make a test fixture work would have widened
// that surface permanently, for every user, to save writing this file.
// So the fixture comes through here instead: same shape as
// test-plaid-link, which seeds this account's Sandbox bank for the same
// suite and for the same reason.
//
// GATING
//
// verify_jwt is on (see ci.yml's JWT_FUNCTIONS), so the platform has
// already rejected anyone without a valid Supabase session before this
// runs. On top of that, the caller must BE the dummy account: minting a
// session for it needs TEST_LOGIN_SECRET, which only CI holds. A real
// user's token reaches this function and gets a 403 -- there is no
// argument that makes it write to their ledger.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { buildE2eLedger, E2E_SOURCE } from "../_shared/e2eLedger.ts";

// The one account this function is allowed to touch. Same constant
// test-login/index.ts signs in as and test-plaid-link guards on -- these
// are a set, and a session for anything else has no business here.
const TEST_ACCOUNT_EMAIL = "synthetic-monitor@scorecard.test";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Only ever rows carrying the marker. The Sandbox-synced rows
// (source = 'plaid') and anything else on the account are untouched, so
// this cannot undo what test-plaid-link seeded.
async function clearSeededRows(db: ReturnType<typeof supabaseAdmin>, userId: string) {
  const { data, error } = await db
    .from("transactions")
    .delete()
    .eq("user_id", userId)
    .eq("source", E2E_SOURCE)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const user = await requireUser(req);
    if (user.email !== TEST_ACCOUNT_EMAIL) {
      return json({ error: "test-seed-ledger only operates on the designated test account." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const db = supabaseAdmin();

    // Always clears first, whichever action this is: a run that seeded
    // twice would report doubled totals, which is worse than an empty
    // ledger because it looks like data.
    const cleared = await clearSeededRows(db, user.id);
    if (body?.action === "clear") {
      return json({ cleared, seeded: 0 });
    }

    const rows = buildE2eLedger().map((row) => ({ ...row, user_id: user.id }));
    const { error } = await db.from("transactions").insert(rows);
    if (error) throw error;

    return json({ cleared, seeded: rows.length });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : err.status || 500;
    return json({ error: err.body || String(err.message || err) }, status);
  }
});
