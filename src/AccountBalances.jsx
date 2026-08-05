import { useState, useEffect } from "react";
import { Landmark, Unlink } from "lucide-react";
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
// connected. Each chip also carries a disconnect button (api/plaid-
// disconnect.js), gated behind a two-step, increasingly-worded confirmation
// -- this revokes real bank access and eventually deletes real transaction
// history, so it gets more friction than any other destructive action in
// the app.
export default function AccountBalances({ accessToken, onLinked }) {
  const [balances, setBalances] = useState(null); // null = not loaded yet
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  // null | { itemId, label, siblingLabels, step: 1 | 2, submitting, error }
  const [disconnect, setDisconnect] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();
    Promise.all([
      supabase.from("plaid_accounts").select("account_id, item_id, name, mask"),
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
              // Plaid Items (not individual accounts) are what
              // api/plaid-disconnect.js actually revokes -- disconnecting
              // one account here disconnects every sibling account under
              // the same bank connection too. Kept so the confirmation
              // flow can warn about that instead of surprising the user.
              itemId: a.item_id,
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

  // Disconnecting is intentionally a two-step, increasingly-worded
  // confirmation, not the single-step "Delete this rule?" pattern used
  // elsewhere -- unlike a category rule, this revokes real bank access
  // and (per the 90-day retention policy) eventually deletes real
  // transaction history for good. Cancel at either step aborts entirely
  // rather than stepping back, so there's always one easy way out.
  function startDisconnect(account) {
    const siblingLabels = balances
      .filter((b) => b.itemId === account.itemId && b.id !== account.id)
      .map((b) => b.label);
    setDisconnect({ itemId: account.itemId, label: account.label, siblingLabels, step: 1, submitting: false, error: null });
  }

  function cancelDisconnect() {
    setDisconnect(null);
  }

  function escalateDisconnect() {
    setDisconnect((d) => (d ? { ...d, step: 2 } : d));
  }

  async function confirmDisconnect() {
    setDisconnect((d) => (d ? { ...d, submitting: true, error: null } : d));
    try {
      const resp = await fetch("/api/plaid-disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: disconnect.itemId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || "Couldn't disconnect — try again");
      }
      setDisconnect(null);
      setRefreshKey((k) => k + 1);
      onLinked?.();
    } catch (e) {
      setDisconnect((d) => (d ? { ...d, submitting: false, error: e.message } : d));
    }
  }

  return (
    <div style={styles.balancesCard}>
      {/* Icon is already red at rest (balanceChipDisconnectBtn); hover just
          adds a background -- var(--surface), not var(--surface-recessed),
          since the chip itself is already --surface-recessed and would
          make that background invisible. */}
      <style>{`.balance-disconnect-btn:hover { background: var(--surface); }`}</style>
      <div style={styles.balancesHeaderRow}>
        <Landmark size={16} style={styles.balancesIcon} role="img" aria-label="Banks" />
        {!showConfirm && !disconnect && (
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
      </div>

      {balances.length > 0 ? (
        <div style={styles.balancesRow}>
          {balances.map((b) => (
            <div key={b.id} style={styles.balanceChip}>
              <div style={styles.balanceChipTopRow}>
                <div style={styles.balanceChipLabel}>{b.label}</div>
                <button
                  onClick={() => startDisconnect(b)}
                  style={styles.balanceChipDisconnectBtn}
                  className="balance-disconnect-btn"
                  title="Disconnect bank"
                  aria-label={`Disconnect ${b.label}`}
                >
                  <Unlink size={15} />
                </button>
              </div>
              <div style={{ ...styles.balanceChipAmount, color: b.amount < 0 ? "var(--danger)" : "var(--text)" }}>
                {fmtMoney(b.amount)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.balancesEmpty}>No linked accounts yet</div>
      )}

      {showConfirm && (
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
      )}

      {disconnect && disconnect.step === 1 && (
        <div style={styles.addBankConfirm}>
          <div style={styles.addBankConfirmText}>
            Disconnect {disconnect.label}? This stops new transactions from syncing.
            {disconnect.siblingLabels.length > 0 && (
              <> This will also disconnect {disconnect.siblingLabels.join(", ")}, since they share the same bank connection.</>
            )}{" "}
            Existing transaction history is kept for 90 days in case you reconnect, then permanently deleted.
          </div>
          <div style={styles.addBankConfirmActions}>
            <button onClick={cancelDisconnect} style={styles.addBankConfirmCancel} autoFocus>
              Cancel
            </button>
            <button onClick={escalateDisconnect} style={styles.addBankConfirmProceed}>
              Continue
            </button>
          </div>
        </div>
      )}

      {disconnect && disconnect.step === 2 && (
        <div style={styles.disconnectConfirmFinal}>
          <div style={styles.disconnectConfirmFinalText}>
            <strong>Are you absolutely sure?</strong> This can't be undone from the app — you'd need to reconnect
            {disconnect.siblingLabels.length > 0 ? " these accounts" : " this account"} through Plaid to restore
            access, and after 90 days any transaction history that isn't reconnected is gone for good.
          </div>
          <div style={styles.addBankConfirmActions}>
            <button onClick={cancelDisconnect} style={styles.addBankConfirmCancel} autoFocus disabled={disconnect.submitting}>
              Cancel
            </button>
            <button onClick={confirmDisconnect} style={styles.ruleDeleteConfirmDelete} disabled={disconnect.submitting}>
              {disconnect.submitting ? "Disconnecting…" : `Yes, disconnect ${disconnect.label}`}
            </button>
          </div>
          {disconnect.error && <div style={styles.ruleError}>{disconnect.error}</div>}
        </div>
      )}
      {error && <div style={styles.ruleError}>{error}</div>}
    </div>
  );
}
