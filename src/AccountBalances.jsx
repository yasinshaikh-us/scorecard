import { useState, useEffect } from "react";
import { styles } from "./styles.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { fmtMoney } from "./logic.js";
import { useBankLink } from "./useBankLink.js";

// Accounts-summary strip. Reads plaid_accounts + plaid_account_balances
// directly via the already-authenticated Supabase client (same RLS-scoped
// pattern App.jsx uses for the plaid_items link-status check) -- no new
// API route needed, since both tables already carry a `Users read their
// own ...` policy for `authenticated`. Always renders once loaded (even
// for a manual-only ledger with zero linked accounts) so the "+ Add bank"
// button -- the only way to link a bank after the first-login gate --
// has somewhere to live regardless of how many accounts are already
// connected.
export default function AccountBalances({ accessToken, onLinked }) {
  const [balances, setBalances] = useState(null); // null = not loaded yet
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();
    Promise.all([
      supabase.from("plaid_accounts").select("account_id, name, mask"),
      supabase.from("plaid_account_balances").select("account_id, current, available"),
    ])
      .then(([accountsRes, balancesRes]) => {
        if (cancelled) return;
        if (accountsRes.error || balancesRes.error) {
          setBalances([]);
          return;
        }
        const balanceByAccount = {};
        (balancesRes.data || []).forEach((b) => { balanceByAccount[b.account_id] = b; });
        const rows = (accountsRes.data || [])
          .map((a) => {
            const bal = balanceByAccount[a.account_id];
            // Prefer the ledger ("current") balance -- what's actually in
            // the account -- falling back to "available" (e.g. credit
            // cards, where Plaid sometimes only populates one of the two).
            const amount = bal?.current ?? bal?.available;
            if (amount == null) return null;
            return {
              id: a.account_id,
              label: `${a.name || "Account"}${a.mask ? ` ••${a.mask}` : ""}`,
              amount: Number(amount),
            };
          })
          .filter(Boolean);
        setBalances(rows);
      })
      .catch(() => {
        if (!cancelled) setBalances([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const { startLink, connecting, error } = useBankLink(accessToken, () => {
    setRefreshKey((k) => k + 1);
    onLinked?.();
  });

  if (!balances) return null; // still loading -- avoid a layout flash

  return (
    <div style={styles.balancesCard}>
      {balances.length > 0 ? (
        <>
          <div style={styles.balancesLabel}>Banks</div>
          <div style={styles.balancesRow}>
            {balances.map((b) => (
              <div key={b.id} style={styles.balanceChip}>
                <div style={styles.balanceChipLabel}>{b.label}</div>
                <div style={{ ...styles.balanceChipAmount, color: b.amount < 0 ? "var(--danger)" : "var(--text)" }}>
                  {fmtMoney(b.amount)}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={styles.balancesEmpty}>No linked accounts yet</div>
      )}

      {showConfirm ? (
        // Plaid Link's own account_filters already restricts selection to
        // depository accounts (see api/plaid-link-token.js) -- this banner
        // is what tells the user that *before* they're in Plaid's UI
        // picking an account, not just silently excluding options there.
        <div style={styles.addBankConfirm}>
          <div style={styles.addBankConfirmText}>Only checking / savings accounts can be connected.</div>
          <div style={styles.addBankConfirmActions}>
            <button onClick={() => setShowConfirm(false)} style={styles.addBankConfirmCancel} autoFocus>
              Cancel
            </button>
            <button
              onClick={() => { setShowConfirm(false); startLink(); }}
              style={styles.addBankConfirmProceed}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Proceed"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={connecting}
          style={styles.addBankBtn}
          title="Add bank"
          aria-label="Add bank"
        >
          {connecting ? "Connecting…" : "+"}
        </button>
      )}
      {error && <div style={styles.ruleError}>{error}</div>}
    </div>
  );
}
