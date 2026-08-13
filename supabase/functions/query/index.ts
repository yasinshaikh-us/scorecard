// Edge Function. Called by the Expo app in mobile/ (see mobile/lib/).
// Runs server-side only — this is where ANTHROPIC_API_KEY actually
// lives, set as a Supabase Edge Function secret. The client never sees
// it. The Anthropic call is I/O wait, not CPU time, so it doesn't count
// against Edge Functions' 2-second CPU-time cap; it does need to finish
// within the 150-second request idle timeout, which is generous headroom
// for a normal LLM response.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/requireUser.ts";
import { fetchLedgerMeta, fetchAccountLabels } from "../_shared/transactionsData.ts";
import { buildSystemPrompt } from "../_shared/querySystemPrompt.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." }), {
      status: 500,
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

  const body = await req.json().catch(() => ({}));
  const question = body?.question;
  if (typeof question !== "string" || !question.trim()) {
    return new Response(JSON.stringify({ error: "Request must include a non-empty 'question' string." }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  try {
    const user = await requireUser(req);

    const [meta, labels] = await Promise.all([
      fetchLedgerMeta(url, anonKey, user.accessToken),
      fetchAccountLabels(url, anonKey, user.accessToken),
    ]);
    // Reproduces the same ACCOUNTS list a full-row fetch used to produce
    // (every account actually referenced by a transaction, via its
    // resolved name+mask label or the "Linked account" fallback for an
    // orphaned id, plus "Manual entry" iff at least one row has no
    // plaid_account_id) from meta's small distinct-id list instead of
    // every row.
    const accountLabels = meta.accountIds.map((id: string) => labels[id] || "Linked account");
    if (meta.hasManual) accountLabels.push("Manual entry");
    const ACCOUNTS = [...new Set(accountLabels)].sort();
    const system = buildSystemPrompt(meta.categories, meta.subcategories, ACCOUNTS, meta.minDate, meta.maxDate);

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });

    const data = await anthropicResp.json();

    if (!anthropicResp.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: anthropicResp.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
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
