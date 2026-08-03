import { useMemo } from "react";
import { styles } from "./styles.js";
import { iconForCategory } from "./categoryIcons.js";
import { topCategory, fmtDate, fmtMoney } from "./logic.js";
import AccountBalances from "./AccountBalances.jsx";

// Canned questions handed straight to the same runQuery() the Ask page's
// own input bar uses -- these are just pre-typed shortcuts into the exact
// same NL query pipeline, not a separate summary feature to keep in sync.
const SHORTCUTS = [
  { label: "This month's spending", question: "How much have I spent this month?" },
  { label: "Top categories", question: "Which categories do I spend the most on?" },
  { label: "Recent transactions", question: "Show me my recent transactions" },
];

const RECENT_COUNT = 5;

// Landing page: accounts summary + quick ways into the Ask page. Doesn't
// fetch anything itself -- `transactions` is the same already-fetched,
// already-cleaned array the Ask page's QueryCard reads from dataStore.js,
// just also handed down as real React state so this component re-renders
// when it changes.
export default function HomePage({ transactions, dataStatus, onAskShortcut }) {
  const recent = useMemo(() => {
    return transactions.slice().sort((a, b) => b.Date.localeCompare(a.Date)).slice(0, RECENT_COUNT);
  }, [transactions]);

  const ready = dataStatus === "ready";

  return (
    <>
      <AccountBalances />

      <div style={styles.card}>
        <div style={styles.balancesLabel}>Quick Questions</div>
        <div style={styles.pillRow}>
          {SHORTCUTS.map((s) => (
            <button
              key={s.label}
              style={styles.homePill}
              disabled={!ready}
              onClick={() => onAskShortcut(s.question)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.balancesLabel}>Recent Activity</div>
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
          {recent.length === 0 && <div style={styles.txEmpty}>{ready ? "No transactions yet" : "Loading…"}</div>}
        </div>
      </div>
    </>
  );
}
