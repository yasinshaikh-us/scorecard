import { test, expect } from "@playwright/test";

// Layer 1 of the synthetic-monitoring framework: unauthenticated black-box
// checks against a real, already-deployed instance of the app (see
// playwright.synthetic.config.js — baseURL comes from SYNTHETIC_BASE_URL).
// These need no Supabase/Anthropic credentials at all, so they can run on a
// schedule right away. Layers 2 (authenticated NL queries + date-range
// correctness) and 3 (direct Supabase cross-checks) live in the sibling
// auth-queries.spec.js / db-crosscheck.spec.js files, not yet implemented.

test("an unauthenticated visitor sees the Google sign-in screen, not the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
});

test("GET /api/transactions without a session is rejected, not served", async ({ request }) => {
  const res = await request.get("/api/transactions");
  expect(res.status()).toBe(401);
  expect((await res.json()).error).toBe("Unauthorized");
});

test("POST /api/query without a session is rejected, not served", async ({ request }) => {
  const res = await request.post("/api/query", {
    data: { system: "test", messages: [{ role: "user", content: "hi" }] },
  });
  expect(res.status()).toBe(401);
  expect((await res.json()).error).toBe("Unauthorized");
});

test("a garbage bearer token is rejected the same way as no token", async ({ request }) => {
  const res = await request.get("/api/transactions", {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  expect(res.status()).toBe(401);
  expect((await res.json()).error).toBe("Unauthorized");
});
