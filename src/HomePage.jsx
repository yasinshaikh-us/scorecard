import { useMemo } from "react";
import { styles } from "./styles.js";
import { iconForCategory } from "./categoryIcons.js";
import { topCategory, fmtDate, fmtMoney, daysBefore } from "./logic.js";
import AccountBalances from "./AccountBalances.jsx";

const RECENT_DAYS = 7;

// Landing page: accounts summary + quick ways into the Ask page. Doesn't
// fetch anything itself -- `transactions` is the same already-fetched,
// already-cleaned array the Ask page's QueryCard reads from dataStore.js,
// just also handed down as real React state so this component re-renders
// when it changes.
export default function HomePage({ transactions, dataStatus, onGoToAsk, accessToken, onBankLinked }) {
  const recent = useMemo(() => {
    if (transactions.length === 0) return [];
    // Anchored to the ledger's own latest date, not the real "now" -- see
    // daysBefore's comment for why (matches system-prompt's "today" logic).
    const maxDate = transactions.reduce((a, d) => (d.Date > a ? d.Date : a), transactions[0].Date);
    const cutoff = daysBefore(maxDate, RECENT_DAYS);
    return transactions
      .filter((d) => d.Date >= cutoff)
      .slice()
      .sort((a, b) => b.Date.localeCompare(a.Date));
  }, [transactions]);

  const ready = dataStatus === "ready";

  return (
    <>
      <AccountBalances accessToken={accessToken} onLinked={onBankLinked} />

      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div style={styles.balancesLabel}>Recent Activity</div>
          <a
            href="/ask"
            onClick={(e) => { e.preventDefault(); onGoToAsk(); }}
            aria-label="Ask a question"
            style={styles.recentAskLink}
          >
            Ask
          </a>
        </div>
        <div style={styles.recentWrap}>
          {recent.map((d, i) => {
            const Icon = iconForCategory(topCategory(d.Category));
            return (
              <div key={i} style={styles.txRow}>
                <div style={styles.txRowTop}>
                  <div style={styles.txPayee}>{d.Payee}</div>
                  <div style={styles.txRight}>
                    <span
                      title={d.Category}
                      aria-label={d.Category}
                      style={{ ...styles.categoryIconBadge, background: "var(--surface-recessed)", color: "var(--text-muted)" }}
                    >
                      <Icon size={14} />
                    </span>
                    <span style={{ ...styles.txAmount, color: d.Amount < 0 ? "var(--danger)" : "var(--accent)" }}>
                      {fmtMoney(d.Amount)}
                    </span>
                  </div>
                </div>
                <div style={styles.txDate}>{fmtDate(d.Date)}</div>
              </div>
            );
          })}
          {recent.length === 0 && (
            <div style={styles.txEmpty}>
              {!ready ? "Loading…" : transactions.length === 0 ? "No transactions yet" : "Nothing in the last week"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
