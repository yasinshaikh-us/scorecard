import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import middleware from "./middleware.js";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "test-anon-key";

function req(path, { authorization } = {}) {
  return new Request(`http://x.test${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

describe("middleware", () => {
  const realEnv = { ...process.env };
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;
  });
  afterEach(() => {
    process.env = { ...realEnv };
    global.fetch = realFetch;
  });

  it("lets any non-API path through unconditionally", async () => {
    expect(await middleware(req("/"))).toBeUndefined();
    expect(await middleware(req("/assets/index.js"))).toBeUndefined();
  });

  it("401s an API request with no Authorization header", async () => {
    const res = await middleware(req("/api/transactions"));
    expect(res.status).toBe(401);
  });

  it("500s an API request when Supabase env vars aren't configured", async () => {
    delete process.env.SUPABASE_URL;
    const res = await middleware(req("/api/transactions", { authorization: "Bearer x" }));
    expect(res.status).toBe(500);
  });

  it("401s when the token doesn't validate against Supabase Auth", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const res = await middleware(req("/api/transactions", { authorization: "Bearer bad-token" }));
    expect(res.status).toBe(401);
  });

  it("passes an API request through with a valid token, forwarding it to Supabase Auth for verification", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const res = await middleware(req("/api/transactions", { authorization: "Bearer good-token" }));
    expect(res).toBeUndefined();

    expect(global.fetch).toHaveBeenCalledWith(
      `${SUPABASE_URL}/auth/v1/user`,
      { headers: { apikey: ANON_KEY, Authorization: "Bearer good-token" } }
    );
  });
});
