// Verifies a Plaid webhook request per Plaid's JWT verification scheme:
// https://plaid.com/docs/api/webhooks/webhook-verification/
//
// The webhook's JWT (Plaid-Verification header) is signed with a key
// Plaid rotates; the key id (`kid`) in the JWT header tells us which key
// to fetch from Plaid's webhook_verification_key/get endpoint. We then
// verify the signature and that the claimed body hash matches the raw
// request body actually received (so this must run on the raw bytes,
// before any JSON.parse).

import { importJWK, jwtVerify, decodeProtectedHeader } from "npm:jose@6";
import { plaidClient } from "./plaid.ts";

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

export async function verifyPlaidWebhook(rawBody: string, verificationJwt: string | null) {
  if (!verificationJwt) {
    throw new Error("Missing Plaid-Verification header");
  }

  const { kid } = decodeProtectedHeader(verificationJwt);
  if (!kid) {
    throw new Error("Plaid-Verification JWT has no kid");
  }

  const client = plaidClient();
  const keyResp = await client.webhookVerificationKeyGet({ key_id: kid });
  const jwk = keyResp.data.key;

  const key = await importJWK(jwk as unknown as JsonWebKey, "ES256");
  const { payload } = await jwtVerify(verificationJwt, key);

  const issuedAt = payload.iat as number;
  const ageSeconds = Date.now() / 1000 - issuedAt;
  if (ageSeconds > MAX_WEBHOOK_AGE_SECONDS) {
    throw new Error("Plaid webhook JWT is too old");
  }

  const bodyHash = await sha256Hex(rawBody);
  if (bodyHash !== payload.request_body_sha256) {
    throw new Error("Plaid webhook body hash mismatch");
  }
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
