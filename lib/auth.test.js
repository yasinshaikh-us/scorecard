import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  verifyPin,
  parseCookies,
  tooManyAttempts,
  recordFailedAttempt,
  MAX_ATTEMPTS,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "./auth.js";

describe("createSessionToken / verifySessionToken", () => {
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });
  afterEach(() => {
    process.env = { ...realEnv };
  });

  it("round-trips: a freshly created token verifies as valid", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects a missing token", async () => {
    expect(await verifySessionToken(null)).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("")).toBe(false);
  });

  it("rejects a malformed token (no '.' separator)", async () => {
    expect(await verifySessionToken("not-a-real-token")).toBe(false);
  });

  it("rejects an expired token", async () => {
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
    expect(await verifySessionToken(`${expiry}.${mac}`)).toBe(false);
  });

  it("rejects a token whose MAC doesn't match (tampered expiry)", async () => {
    const token = await createSessionToken();
    const [, mac] = token.split(".");
    const futureExpiry = Date.now() + 1000 * 60 * 60 * 24 * 365; // tamper: extend expiry
    expect(await verifySessionToken(`${futureExpiry}.${mac}`)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken();
    process.env.SESSION_SECRET = "a-different-secret";
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("throws when SESSION_SECRET is missing", async () => {
    delete process.env.SESSION_SECRET;
    await expect(createSessionToken()).rejects.toThrow("Missing SESSION_SECRET");
  });
});

describe("verifyPin", () => {
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.SITE_PIN = "4821";
  });
  afterEach(() => {
    process.env = { ...realEnv };
  });

  it("accepts the correct PIN", () => {
    expect(verifyPin("4821")).toBe(true);
  });

  it("rejects an incorrect PIN", () => {
    expect(verifyPin("0000")).toBe(false);
  });

  it("rejects a PIN that's a prefix/suffix of the real one", () => {
    expect(verifyPin("482")).toBe(false);
    expect(verifyPin("48210")).toBe(false);
  });

  it("trims whitespace on both the candidate and the stored PIN", () => {
    process.env.SITE_PIN = "  4821\n";
    expect(verifyPin(" 4821 ")).toBe(true);
  });

  it("throws when SITE_PIN is missing", () => {
    delete process.env.SITE_PIN;
    expect(() => verifyPin("4821")).toThrow("Missing SITE_PIN");
  });
});

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

describe("exported constants", () => {
  it("exposes the cookie name and max-age in seconds", () => {
    expect(SESSION_COOKIE_NAME).toBe("analysis_auth");
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });
});
