import { styles } from "./styles.js";
import QueryCard from "./QueryCard.jsx";

export default function AskPage({ input, onInputChange, onAsk, loading, dataStatus, cards, onRemoveCard }) {
  return (
    <>
      <div style={styles.queryBar}>
        <div style={styles.inputWrap}>
          <input
            style={styles.input}
            value={input}
            placeholder={dataStatus === "ready" ? "" : "Loading…"}
            disabled={dataStatus !== "ready"}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAsk()}
          />
          <button style={styles.askBtn} onClick={onAsk} disabled={loading || dataStatus !== "ready"}>
            {loading ? "…" : "Ask"}
          </button>
        </div>
      </div>

      <div style={styles.feed}>
        {cards.map((c) =>
          c.pending ? (
            <div key={c.id} style={styles.card}>
              <div style={styles.qLabel}>"{c.question}"</div>
              <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0" }}>thinking…</div>
            </div>
          ) : (
            <QueryCard key={c.id} {...c} onRemove={() => onRemoveCard(c.id)} />
          )
        )}
      </div>
    </>
  );
}
