import { describe, it, expect, afterEach } from "vitest";
import middleware, { pinPage } from "./middleware.js";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  MAX_ATTEMPTS,
} from "./lib/auth.js";

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

  it("fails closed (500) when SITE_PIN is set but SESSION_SECRET isn't", async () => {
    process.env.SITE_PIN = "4821";
    delete process.env.SESSION_SECRET;
    const req = new Request("http://x.test/");
    const res = await middleware(req);
    expect(res.status).toBe(500);
  });

  it("shows the PIN page (401) for a GET request with no valid cookie", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
    const req = new Request("http://x.test/", { headers: { "x-forwarded-for": "10.1.0.1" } });
    const res = await middleware(req);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Enter your PIN");
  });

  it("passes through when the request has a valid session cookie", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
    const token = await createSessionToken();
    const req = new Request("http://x.test/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, "x-forwarded-for": "10.1.0.2" },
    });
    expect(await middleware(req)).toBeUndefined();
  });

  it("rejects a malformed cookie the same way as a missing one", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
    const req = new Request("http://x.test/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage`, "x-forwarded-for": "10.1.0.6" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("rejects an expired session token even if otherwise well-formed", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
    const expiry = Date.now() - 1000;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode("test-session-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(String(expiry)));
    const mac = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const req = new Request("http://x.test/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${expiry}.${mac}`, "x-forwarded-for": "10.1.0.7" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("sets a session cookie and redirects on a correct PIN submission", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
    const req = new Request("http://x.test/", {
      method: "POST",
      headers: { "x-forwarded-for": "10.1.0.3" },
      body: new URLSearchParams({ pin: "4821" }),
    });
    const res = await middleware(req);
    expect(res.status).toBe(302);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects an incorrect PIN submission with a 401 error page", async () => {
    process.env.SITE_PIN = "4821";
    process.env.SESSION_SECRET = "test-session-secret";
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
    process.env.SESSION_SECRET = "test-session-secret";
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
