import { test, expect } from "@playwright/test";

// Layer 1 of the synthetic-monitoring framework: unauthenticated black-box
// checks against a real, already-deployed instance of the app (see
// playwright.synthetic.config.js — baseURL comes from SYNTHETIC_BASE_URL)
// plus its Supabase Edge Functions (MONITOR_SUPABASE_URL -- just the
// project URL, the same non-secret value shipped to the browser bundle as
// VITE_SUPABASE_URL, not a credential). Layers 2 (authenticated NL
// queries + date-range correctness) and 3 (direct Supabase cross-checks)
// live in the sibling auth-queries.spec.js / db-crosscheck.spec.js files.

function functionUrl(name) {
  const url = process.env.MONITOR_SUPABASE_URL;
  if (!url) throw new Error("MONITOR_SUPABASE_URL must be set to run the synthetic suite");
  return `${url}/functions/v1/${name}`;
}

test("an unauthenticated visitor sees the Google sign-in screen, not the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
});

// These three only assert the status code, not the error body shape: with
// no Authorization header or a garbage (not even JWT-shaped) bearer token,
// Supabase's own verify_jwt gateway setting rejects the request before it
// ever reaches our function code (see
// supabase/functions/_shared/requireUser.ts), so the body is whatever
// Supabase's platform returns, not this app's own `{ error: ... }` shape.
// requireUser() is the second line of defense, for a well-formed but
// expired/revoked JWT that passes the gateway's own check.

test("GET transactions without a session is rejected, not served", async ({ request }) => {
  const res = await request.get(functionUrl("transactions"));
  expect(res.status()).toBe(401);
});

test("POST query without a session is rejected, not served", async ({ request }) => {
  const res = await request.post(functionUrl("query"), {
    data: { system: "test", messages: [{ role: "user", content: "hi" }] },
  });
  expect(res.status()).toBe(401);
});

test("a garbage bearer token is rejected the same way as no token", async ({ request }) => {
  const res = await request.get(functionUrl("transactions"), {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  expect(res.status()).toBe(401);
});
