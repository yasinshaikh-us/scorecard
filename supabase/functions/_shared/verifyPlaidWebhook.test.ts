import { describe, it, expect, vi, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

// This is the security boundary for plaid-webhook. That function is
// deployed with --no-verify-jwt (Plaid calls it directly, not a signed-in
// user), so Supabase's gateway does NOT authenticate it -- this file is
// the only thing standing between an arbitrary POST from the internet and
// real writes to the transactions table.
//
// These tests therefore use REAL cryptography: a real ES256 keypair, real
// signed JWTs, and the function's own real SHA-256 body hashing. Nothing
// about the verification path is stubbed except the network call that
// fetches Plaid's public key. A test that mocked the crypto would prove
// nothing about whether a forged webhook is actually rejected.

const webhookVerificationKeyGet = vi.fn();

// plaid.ts reads Deno.env and imports npm:plaid, neither of which resolves
// under Node -- replaced wholesale so it is never loaded. The `npm:jose@5`
// import inside verifyPlaidWebhook.ts is handled differently, by a real
// alias to the real jose package (see vitest.config.js), because the
// signature verification is exactly what's under test here.
vi.mock("./plaid.ts", () => ({
  plaidClient: () => ({ webhookVerificationKeyGet }),
}));

const { verifyPlaidWebhook } = await import("./verifyPlaidWebhook.ts");

const KID = "test-key-id";
const BODY = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" });

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let otherPrivateKey: CryptoKey;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signToken({
  body = BODY,
  issuedAt = Math.floor(Date.now() / 1000),
  // A boolean rather than `kid: undefined`, because JS default parameters
  // treat an explicit undefined as "not passed" and would silently restore
  // the default kid -- making the no-kid rejection test pass vacuously.
  omitKid = false,
  key = privateKey,
  bodyHash,
}: {
  body?: string;
  issuedAt?: number;
  omitKid?: boolean;
  key?: CryptoKey;
  bodyHash?: string;
} = {}) {
  const claims = { request_body_sha256: bodyHash ?? (await sha256Hex(body)) };
  const header: { alg: string; kid?: string } = { alg: "ES256" };
  if (!omitKid) header.kid = KID;
  return new SignJWT(claims).setProtectedHeader(header).setIssuedAt(issuedAt).sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  publicJwk = (await exportJWK(pair.publicKey)) as Record<string, unknown>;
  otherPrivateKey = (await generateKeyPair("ES256", { extractable: true })).privateKey as CryptoKey;
  webhookVerificationKeyGet.mockResolvedValue({ data: { key: publicJwk } });
});

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh webhook whose body hash matches", async () => {
    await expect(verifyPlaidWebhook(BODY, await signToken())).resolves.toBeUndefined();
  });

  it("fetches the verification key using the kid from the token header", async () => {
    webhookVerificationKeyGet.mockClear();
    await verifyPlaidWebhook(BODY, await signToken());
    expect(webhookVerificationKeyGet).toHaveBeenCalledWith({ key_id: KID });
  });

  describe("rejects", () => {
    it("a request with no Plaid-Verification header at all", async () => {
      await expect(verifyPlaidWebhook(BODY, null)).rejects.toThrow("Missing Plaid-Verification header");
    });

    it("an empty Plaid-Verification header", async () => {
      await expect(verifyPlaidWebhook(BODY, "")).rejects.toThrow("Missing Plaid-Verification header");
    });

    it("a token whose header carries no kid", async () => {
      await expect(verifyPlaidWebhook(BODY, await signToken({ omitKid: true })))
        .rejects.toThrow("Plaid-Verification JWT has no kid");
    });

    // The forgery case: an attacker can trivially produce a well-formed
    // JWT with a correct body hash. Only the signature check stops it.
    it("a token signed by a key that is not Plaid's", async () => {
      await expect(verifyPlaidWebhook(BODY, await signToken({ key: otherPrivateKey }))).rejects.toThrow();
    });

    it("a structurally invalid token", async () => {
      await expect(verifyPlaidWebhook(BODY, "not-a-jwt")).rejects.toThrow();
    });

    // Replay protection: a validly-signed webhook captured off the wire
    // must stop being accepted once it ages past the 5-minute window.
    it("a validly signed token older than the 5-minute freshness window", async () => {
      const issuedAt = Math.floor(Date.now() / 1000) - (5 * 60 + 30);
      await expect(verifyPlaidWebhook(BODY, await signToken({ issuedAt })))
        .rejects.toThrow("Plaid webhook JWT is too old");
    });

    // Tamper protection: the signature covers the hash, not the body, so
    // without this comparison an attacker could swap the body wholesale
    // while replaying a genuine signed token.
    it("a body that does not match the hash the token claims", async () => {
      const token = await signToken({ body: BODY });
      const tamperedBody = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "TAMPERED" });
      await expect(verifyPlaidWebhook(tamperedBody, token)).rejects.toThrow("Plaid webhook body hash mismatch");
    });

    it("a token claiming a body hash that is not a hash of anything sent", async () => {
      const token = await signToken({ bodyHash: "0".repeat(64) });
      await expect(verifyPlaidWebhook(BODY, token)).rejects.toThrow("Plaid webhook body hash mismatch");
    });
  });

  describe("accepts at the edges of the freshness window", () => {
    it("a token issued just inside the 5-minute window", async () => {
      const issuedAt = Math.floor(Date.now() / 1000) - (5 * 60 - 10);
      await expect(verifyPlaidWebhook(BODY, await signToken({ issuedAt }))).resolves.toBeUndefined();
    });

    // Clock skew: Plaid's clock running slightly ahead yields a future
    // iat, which produces a negative age. That is currently accepted --
    // pinned so the behavior is a known choice rather than an accident.
    it("a token whose iat is slightly in the future (clock skew)", async () => {
      const issuedAt = Math.floor(Date.now() / 1000) + 30;
      await expect(verifyPlaidWebhook(BODY, await signToken({ issuedAt }))).resolves.toBeUndefined();
    });
  });

  it("hashes the exact raw body bytes, so whitespace changes are rejected", async () => {
    // The function must run on the raw request text, before JSON.parse --
    // re-serializing would change the bytes and break verification.
    const token = await signToken({ body: BODY });
    await expect(verifyPlaidWebhook(BODY + " ", token)).rejects.toThrow("Plaid webhook body hash mismatch");
  });
});
