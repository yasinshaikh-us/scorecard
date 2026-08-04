import { styles } from "./styles.js";
import QueryCard from "./QueryCard.jsx";

// Idle-state inspiration, not a data feature -- deliberately not pill/chip
// buttons (that reads as a fixed menu of options); plain, faint, softly
// shadowed text drifting upward and fading out feels more like ambient
// suggestion than a UI control, while still being clickable. Only shown
// before any question has been asked (see `cards.length === 0` below) --
// once the feed has cards, this space is real content, not empty.
const SUGGESTIONS = [
  "How much did I spend on dining last month?",
  "What's my biggest expense this year?",
  "Top 10 expenses this month",
  "How much did I spend at Chipotle?",
  "What's my average grocery purchase?",
  "Which category do I spend the most on?",
  "Show me my recent transactions",
  "How much have I spent this month?",
  "What was my largest deposit this year?",
  "How much did I spend on travel this year?",
];

// 5 lanes spaced exactly one button-width (18%, see .ask-suggestion's
// max-width) apart, so two suggestions never share the same horizontal
// reading space even if their float cycles happen to line up vertically.
const SUGGESTION_LANES = [2, 22, 42, 62, 82];

export default function AskPage({ input, onInputChange, onAsk, onSuggestionClick, loading, dataStatus, cards, onRemoveCard, onTransactionEdited }) {
  return (
    <>
      <style>{`
        .ask-suggestion {
          position: absolute;
          max-width: 18%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          background: none;
          border: none;
          padding: 4px 0;
          color: var(--text-muted);
          font-family: var(--font-body);
          font-size: 14px;
          font-style: italic;
          /* A background-colored halo (not a real text-stroke, which isn't
             reliably supported) rather than a black drop-shadow -- a dark
             shadow disappears against an already-dark background, so this
             keeps the same contrast trick working in both themes. */
          text-shadow: 0 0 5px var(--bg), 0 0 9px var(--bg), 0 0 9px var(--bg);
          cursor: pointer;
          animation-name: ask-suggestion-float;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .ask-suggestion:hover { color: var(--text); }
        @keyframes ask-suggestion-float {
          0% { bottom: -8%; opacity: 0; }
          12% { opacity: 0.85; }
          82% { opacity: 0.65; }
          100% { bottom: 104%; opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Each button's own --rm-bottom (set inline below) keeps the 10
             suggestions spread out statically -- a single fixed bottom
             for all of them would stack every same-lane pair exactly on
             top of each other once the animation that normally separates
             them in time is turned off. */
          .ask-suggestion { animation: none; opacity: 0.7; bottom: var(--rm-bottom, 50%); }
        }
      `}</style>

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

      {cards.length === 0 && (
        <div style={styles.suggestionsWrap}>
          {SUGGESTIONS.map((s, i) => (
            <button
              key={s}
              className="ask-suggestion"
              // 5 lanes, each as wide as the button's own max-width (18%)
              // and spaced exactly that far apart -- two suggestions can
              // never overlap into the same reading space, only ever pass
              // near a neighboring lane's edge.
              style={{
                left: `${SUGGESTION_LANES[i % SUGGESTION_LANES.length]}%`,
                animationDelay: `${i * -4.3}s`,
                animationDuration: `${17 + (i % 4) * 3}s`,
                "--rm-bottom": `${8 + i * 9}%`,
              }}
              disabled={dataStatus !== "ready"}
              onClick={() => onSuggestionClick(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={styles.feed}>
        {cards.map((c) =>
          c.pending ? (
            <div key={c.id} style={styles.card}>
              <div style={styles.qLabel}>"{c.question}"</div>
              <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0" }}>thinking…</div>
            </div>
          ) : (
            <QueryCard key={c.id} {...c} onRemove={() => onRemoveCard(c.id)} onTransactionEdited={onTransactionEdited} />
          )
        )}
      </div>
    </>
  );
}
