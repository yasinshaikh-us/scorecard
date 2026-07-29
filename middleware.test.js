import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import middleware, {
  pinPage, parseCookies, sha256Hex, tooManyAttempts, recordFailedAttempt, MAX_ATTEMPTS,
} from "./middleware.js";

describe("parseCookies", () => {
  it("returns an empty object for a missing/empty header", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookies("analysis_auth=abc123")).toEqual({ analysis_auth: "abc123" });
  });

  it("parses multiple cookies and decodes values", () => {
    const out = parseCookies("a=1; b=hello%20world; c=3");
    expect(out).toEqual({ a: "1", b: "hello world", c: "3" });
  });
});

describe("sha256Hex", () => {
  it("is deterministic for the same input", async () => {
    const a = await sha256Hex("hello:world");
    const b = await sha256Hex("hello:world");
    expect(a).toBe(b);
  });

  it("produces a 64-char lowercase hex string", async () => {
    const hash = await sha256Hex("anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different input", async () => {
    const a = await sha256Hex("pin1");
    const b = await sha256Hex("pin2");
    expect(a).not.toBe(b);
  });
});

describe("tooManyAttempts / recordFailedAttempt", () => {
  it("a fresh IP is never too many", () => {
    expect(tooManyAttempts("10.0.0.1")).toBe(false);
  });

  it("locks out after MAX_ATTEMPTS failures from the same IP", () => {
    const ip = "10.0.0.2";
    expect(tooManyAttempts(ip)).toBe(false); // seeds the window
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(ip);
    expect(tooManyAttempts(ip)).toBe(true);
  });

  it("doesn't affect other IPs", () => {
    const ip = "10.0.0.3";
    const otherIp = "10.0.0.4";
    tooManyAttempts(ip);
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(ip);
    expect(tooManyAttempts(ip)).toBe(true);
    expect(tooManyAttempts(otherIp)).toBe(false);
  });
});

describe("pinPage", () => {
  it("renders one .pin-box input per PIN digit", () => {
    const html6 = pinPage(false, 6);
    expect((html6.match(/class="pin-box"/g) || []).length).toBe(6);

    const html4 = pinPage(false, 4);
    expect((html4.match(/class="pin-box"/g) || []).length).toBe(4);
  });

  it("falls back to 6 boxes for an out-of-range length", () => {
    expect((pinPage(false, 20).match(/class="pin-box"/g) || []).length).toBe(6);
    expect((pinPage(false, 0).match(/class="pin-box"/g) || []).length).toBe(6);
  });

  it("shows the error message only when showError is true", () => {
    expect(pinPage(true, 6)).toContain("Incorrect PIN");
    expect(pinPage(false, 6)).not.toContain("Incorrect PIN");
  });
});

describe("middleware", () => {
  const realEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...realEnv };
  });

  it("passes every request through when SITE_PIN isn't set", async () => {
    delete process.env.SITE_PIN;
    const req = new Request("http://x.test/");
    expect(await middleware(req)).toBeUndefined();
  });

  it("shows the PIN page (401) for a GET request with no valid cookie", async () => {
    process.env.SITE_PIN = "4821";
    const req = new Request("http://x.test/", { headers: { "x-forwarded-for": "10.1.0.1" } });
    const res = await middleware(req);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Enter your PIN");
  });

  it("passes through when the request has the correct auth cookie", async () => {
    process.env.SITE_PIN = "4821";
    const expected = await sha256Hex("4821:analysis-lock");
    const req = new Request("http://x.test/", {
      headers: { cookie: `analysis_auth=${expected}`, "x-forwarded-for": "10.1.0.2" },
    });
    expect(await middleware(req)).toBeUndefined();
  });

  it("sets the auth cookie and redirects on a correct PIN submission", async () => {
    process.env.SITE_PIN = "4821";
    const req = new Request("http://x.test/", {
      method: "POST",
      headers: { "x-forwarded-for": "10.1.0.3" },
      body: new URLSearchParams({ pin: "4821" }),
    });
    const res = await middleware(req);
    expect(res.status).toBe(302);
    const expected = await sha256Hex("4821:analysis-lock");
    expect(res.headers.get("set-cookie")).toContain(`analysis_auth=${expected}`);
  });

  it("rejects an incorrect PIN submission with a 401 error page", async () => {
    process.env.SITE_PIN = "4821";
    const req = new Request("http://x.test/", {
      method: "POST",
      headers: { "x-forwarded-for": "10.1.0.4" },
      body: new URLSearchParams({ pin: "0000" }),
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Incorrect PIN");
  });

  it("locks out an IP with 429 after MAX_ATTEMPTS wrong PIN submissions", async () => {
    process.env.SITE_PIN = "4821";
    const ip = "10.1.0.5";
    const wrongPinReq = () =>
      new Request("http://x.test/", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: new URLSearchParams({ pin: "0000" }),
      });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await middleware(wrongPinReq());
      expect(res.status).toBe(401);
    }
    const lockedRes = await middleware(wrongPinReq());
    expect(lockedRes.status).toBe(429);
    expect(await lockedRes.text()).toContain("Too many attempts");
  });
});
