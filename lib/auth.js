// Shared auth primitives for the PIN gate. Mirrors the location app's
// lib/auth.ts one-for-one: HMAC-signed expiring session tokens,
// timing-safe comparisons, and a per-IP brute-force guard. Both apps use
// the same design here so a security fix in one is a checklist item in
// the other, not a rethink.
//
// Uses the Web Crypto API (globalThis.crypto.subtle) rather than Node's
// `crypto` module because this runs in Vercel Edge Middleware.

export const SESSION_COOKIE_NAME = "analysis_auth";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Best-effort in-memory brute-force guard. State is per-isolate (resets on
// cold start / redeploy, and isn't shared across edge regions), but it's
// enough to stop a naive script from hammering a 4-8 digit PIN.
export const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;
const attemptsByIp = new Map();

export function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attemptsByIp.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attemptsByIp.set(ip, { windowStart: now, count: 0 });
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = attemptsByIp.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attemptsByIp.set(ip, { windowStart: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET env var");
  }
  return secret;
}

async function hmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function createSessionToken() {
  const expiry = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const mac = await hmacHex(String(expiry), getSecret());
  return `${expiry}.${mac}`;
}

export async function verifySessionToken(token) {
  if (!token) return false;
  const [expiryStr, mac] = token.split(".");
  if (!expiryStr || !mac) return false;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expectedMac = await hmacHex(expiryStr, getSecret());
  return timingSafeEqualStr(mac, expectedMac);
}

export function verifyPin(candidate) {
  const realPin = process.env.SITE_PIN;
  if (!realPin) {
    throw new Error("Missing SITE_PIN env var");
  }
  // Trim whitespace/newlines on both sides — env vars shared across
  // multiple Vercel projects can pick up trailing whitespace depending
  // on how they were set, and this should still match cleanly.
  return timingSafeEqualStr(candidate.trim(), realPin.trim());
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    cookies[k] = decodeURIComponent(v);
  });
  return cookies;
}
