import { describe, it, expect } from "vitest";
import { corsHeaders, handleCorsPreflight } from "./cors.ts";

// The five client-facing Edge Functions run with verify_jwt enabled, which
// rejects any request without a valid Authorization header -- including a
// browser's CORS preflight, which by spec carries none. That's why each of
// them must short-circuit OPTIONS itself before any auth work. These tests
// pin that behavior and the header set the preflight answers with.

describe("corsHeaders", () => {
  it("allows the headers a Supabase client actually sends", () => {
    // apikey is Supabase-specific and easy to forget; without it the
    // preflight fails and every cross-origin call from a browser dies.
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("apikey");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("content-type");
  });

  it("allows the methods these functions are called with", () => {
    expect(corsHeaders["Access-Control-Allow-Methods"]).toContain("GET");
    expect(corsHeaders["Access-Control-Allow-Methods"]).toContain("POST");
    expect(corsHeaders["Access-Control-Allow-Methods"]).toContain("OPTIONS");
  });

  it("is origin-open, which is safe only because these functions authenticate per request", () => {
    // Wildcard origin does not grant data access here: every one of these
    // functions still requires a valid JWT and reads RLS-scoped. If that
    // ever stops being true, this wildcard becomes a real exposure.
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("handleCorsPreflight", () => {
  it("answers an OPTIONS request instead of letting it reach auth", () => {
    const response = handleCorsPreflight(new Request("https://example.test/fn", { method: "OPTIONS" }));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
  });

  it("puts the CORS headers on the preflight response", () => {
    const response = handleCorsPreflight(new Request("https://example.test/fn", { method: "OPTIONS" }))!;
    for (const [header, value] of Object.entries(corsHeaders)) {
      expect(response.headers.get(header)).toBe(value);
    }
  });

  it("returns null for the real methods so the function keeps handling them", () => {
    for (const method of ["GET", "POST"]) {
      expect(handleCorsPreflight(new Request("https://example.test/fn", { method }))).toBeNull();
    }
  });

  it("is case-sensitive on the method, matching how fetch normalizes it", () => {
    // fetch() upper-cases standard methods, so a lowercase "options" never
    // reaches a deployed function -- pinned so the check isn't "loosened"
    // later on the assumption that it must be case-insensitive.
    expect(handleCorsPreflight(new Request("https://example.test/fn", { method: "options" }))).not.toBeNull();
  });
});
