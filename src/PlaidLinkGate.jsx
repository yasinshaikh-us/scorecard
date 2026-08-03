// Shown once, between sign-in and the dashboard, the first time a user
// has no linked bank (no row in plaid_items). Skippable — this never
// blocks access to the dashboard, it just offers the connection.
//
// Flow: fetch a link_token from api/plaid-link-token -> open Plaid Link
// (usePlaidLink) -> on success, send the public_token to
// api/plaid-exchange, which does the real exchange + storage server-side.
// The browser never sees a Plaid access_token, only the short-lived
// link_token and public_token Plaid itself hands back.

import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { styles } from "./styles.js";

export default function PlaidLinkGate({ accessToken, onDone }) {
  const [linkToken, setLinkToken] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/plaid-link-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setLinkToken(data.link_token || null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the bank-connection service");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setStatus("connecting");
      setError(null);
      try {
        const resp = await fetch("/api/plaid-exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!resp.ok) throw new Error("exchange failed");
        onDone();
      } catch {
        setError("Couldn't finish connecting — try again");
        setStatus("idle");
      }
    },
  });

  return (
    <div style={{ ...styles.page, alignItems: "center", justifyContent: "center", minHeight: "100vh", textAlign: "center" }}>
      <div style={styles.brand}>Connect your bank</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>
        Link a bank account so new transactions and balances sync in automatically.
        You can always add this later.
      </div>

      <button
        onClick={() => open()}
        disabled={!ready || status === "connecting"}
        style={{
          background: "var(--accent)",
          border: "none",
          borderRadius: 10,
          padding: "10px 20px",
          color: "var(--surface)",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 600,
          cursor: !ready || status === "connecting" ? "default" : "pointer",
          opacity: !ready || status === "connecting" ? 0.5 : 1,
        }}
      >
        {status === "connecting" ? "Connecting…" : "Connect a bank account"}
      </button>

      <button
        onClick={onDone}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-faint)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Skip for now
      </button>

      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
    </div>
  );
}
