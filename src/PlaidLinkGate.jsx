// Shown once, between sign-in and the dashboard, the first time a user
// has no linked bank (no row in plaid_items). Skippable — this never
// blocks access to the dashboard, it just offers the connection. Banks
// can also be added later (including additional ones beyond the first)
// via the "+ Add bank" button on Home, which shares this same Link flow
// through useBankLink.

import { styles } from "./styles.js";
import { useBankLink } from "./useBankLink.js";

export default function PlaidLinkGate({ accessToken, onDone }) {
  const { startLink, connecting, error } = useBankLink(accessToken, onDone);

  return (
    <div style={{ ...styles.page, alignItems: "center", justifyContent: "center", minHeight: "100vh", textAlign: "center" }}>
      <div style={styles.brand}>Connect your bank</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>
        Link a bank account so new transactions and balances sync in automatically.
        You can always add this later.
      </div>

      <button
        onClick={startLink}
        disabled={connecting}
        style={{
          background: "var(--accent)",
          border: "none",
          borderRadius: 10,
          padding: "10px 20px",
          color: "var(--surface)",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 600,
          cursor: connecting ? "default" : "pointer",
          opacity: connecting ? 0.5 : 1,
        }}
      >
        {connecting ? "Connecting…" : "Connect a bank account"}
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
