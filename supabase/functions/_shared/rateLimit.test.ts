import { describe, it, expect, afterEach, vi } from "vitest";
import { checkQueryRateLimit } from "./rateLimit.ts";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "test-anon-key";
const ACCESS_TOKEN = "test-user-access-token";

describe("checkQueryRateLimit", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("calls the RPC with the caller's own access token, not a service-role key", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ allowed: true, retry_after_seconds: 0 }] })) as any;
    await checkQueryRateLimit(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_query_rate_limit`);
    expect(opts.headers.apikey).toBe(ANON_KEY);
    expect(opts.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("returns allowed: true when under the limit", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ allowed: true, retry_after_seconds: 0 }] })) as any;
    const result = await checkQueryRateLimit(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("returns allowed: false with a positive retryAfterSeconds when over the limit", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ allowed: false, retry_after_seconds: 42 }] })) as any;
    const result = await checkQueryRateLimit(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("throws with the upstream status/body on failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: "boom" }) })) as any;
    await expect(checkQueryRateLimit(SUPABASE_URL, ANON_KEY, ACCESS_TOKEN)).rejects.toMatchObject({
      status: 500,
      body: { message: "boom" },
    });
  });
});
