import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from "recharts";
import { styles, tooltipStyle } from "./styles.js";
import ThemeToggle from "./ThemeToggle.jsx";
import Login from "./Login.jsx";
import PlaidLinkGate from "./PlaidLinkGate.jsx";
import { getSupabaseClient } from "./supabaseClient.js";
import {
  topCategory, computeDataMeta, fmtDate, fmtGroupKey, fmtMoney,
  filterTransactions, groupKeyOf, buildChartData, cleanRows, parseQueryResponse,
} from "./logic.js";

let RAW_DATA = [];

let CATS = [];

// Called once the CSV has been fetched & parsed. Populates the module-level
// data + derived lookups the rest of the app relies on for rendering
// (the system prompt is built server-side in api/query.js, from the same
// transactions fetched independently there via RLS).
function loadData(rows) {
  RAW_DATA = rows;
  ({ CATS } = computeDataMeta(RAW_DATA));
}

const PALETTE = ["#3FA796", "#C1666B", "#E8B04B", "#7B8FA1", "#9B6B9E", "#5C9DAD", "#B98B5E", "#6E9F7E", "#A65D5D", "#8F7EBA", "#5E8B7E", "#C97D60", "#4E8FA8", "#B0567A", "#7EA85E", "#A87E4E", "#6E7EBA", "#C9A05E", "#8E6E9F", "#5E9B8E", "#B87E8E", "#7E9BA8", "#A8945E", "#8E7E5E"];
const catColor = (cat) => PALETTE[CATS.indexOf(topCategory(cat)) % PALETTE.length];

function RowDetailPopover({ x, y, row }) {
  const left = Math.min(x + 14, window.innerWidth - 272);
  const top = Math.min(y + 14, window.innerHeight - 190);
  const type = row.IsTransfer ? "Internal transfer" : row.Amount < 0 ? "Expense" : "Income";
  return (
    <div style={{ ...styles.rowDetailPopover, left, top }}>
      <div style={styles.rowDetailTitle}>{row.Payee}</div>
      {[
        ["Date", fmtDate(row.Date)],
        ["Amount", fmtMoney(row.Amount)],
        ["Category", row.Category],
        ["Account", row.Account],
        ["Type", type],
      ].map(([label, value]) => (
        <div key={label} style={styles.rowDetailRow}>
          <span style={styles.rowDetailLabel}>{label}</span>
          <span style={styles.rowDetailValue}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function QueryCard({ id, question, spec, error, offTopic, onRemove }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  const baseFiltered = useMemo(() => filterTransactions(RAW_DATA, spec), [spec]);

  const chartData = useMemo(() => buildChartData(baseFiltered, spec), [baseFiltered, spec]);

  const displayed = useMemo(() => {
    if (!selectedKey) return baseFiltered;
    return baseFiltered.filter(d => groupKeyOf(spec, d) === selectedKey);
  }, [baseFiltered, selectedKey, spec]);

  const stats = useMemo(() => {
    const expenses = displayed.filter(d => d.Amount < 0);
    const income = displayed.filter(d => d.Amount > 0);
    const spent = expenses.reduce((s, d) => s + Math.abs(d.Amount), 0);
    const earned = income.reduce((s, d) => s + d.Amount, 0);
    return { count: displayed.length, spent, earned, net: earned - spent };
  }, [displayed]);

  const sortedRows = useMemo(() => {
    return displayed.slice().sort((a, b) => b.Date.localeCompare(a.Date));
  }, [displayed]);

  if (error) {
    return (
      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div style={styles.qLabel}>"{question}"</div>
          <button onClick={onRemove} style={styles.closeBtn}>&times;</button>
        </div>
        <div style={{ color: "var(--danger)", fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0" }}>
          Couldn't parse that one — try rephrasing. ({error})
        </div>
      </div>
    );
  }
  if (offTopic) {
    return (
      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div style={styles.qLabel}>"{question}"</div>
          <button onClick={onRemove} style={styles.closeBtn}>&times;</button>
        </div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0" }}>
          This app only answers questions about your own bank-transaction ledger — try something like "how much did I spend on groceries last month?"
        </div>
      </div>
    );
  }
  if (!spec) return null;

  return (
    <div style={styles.card}>
      <div style={styles.cardHeaderRow}>
        <div>
          <div style={styles.qLabel}>"{question}"</div>
          <div style={styles.titleLine}>{spec.title}</div>
        </div>
        <button onClick={onRemove} style={styles.closeBtn}>&times;</button>
      </div>

      {spec.chartType !== "none" && chartData.length > 0 && (
        <div style={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={220}>
            {spec.chartType === "pie" ? (
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="total"
                  nameKey="key"
                  cx="50%" cy="50%"
                  outerRadius={80}
                  onClick={(d) => { const k = d && (d.payload ? d.payload.key : d.key); if (k !== undefined) setSelectedKey(selectedKey === k ? null : k); }}
                  cursor="pointer"
                  isAnimationActive={false}
                >
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={spec.groupBy === "category" ? catColor(d.key) : PALETTE[i % PALETTE.length]}
                      stroke={selectedKey === d.key ? "var(--text)" : "none"} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
              </PieChart>
            ) : spec.chartType === "line" ? (
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="key" tickFormatter={(k) => fmtGroupKey(k, spec.groupBy)} tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                <Tooltip labelFormatter={(k) => fmtGroupKey(k, spec.groupBy)} formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="total" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <BarChart data={chartData} layout={spec.groupBy === "payee" ? "vertical" : "horizontal"}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                {spec.groupBy === "payee" ? (
                  <>
                    <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                    <YAxis type="category" dataKey="key" width={120} tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                  </>
                ) : (
                  <>
                    <XAxis dataKey="key" tickFormatter={(k) => fmtGroupKey(k, spec.groupBy)} tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                  </>
                )}
                <Tooltip labelFormatter={(k) => fmtGroupKey(k, spec.groupBy)} formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
                <Bar dataKey="total" radius={[3, 3, 3, 3]} cursor="pointer" isAnimationActive={false}
                  onClick={(d) => { const k = d && (d.payload ? d.payload.key : d.key); if (k !== undefined) setSelectedKey(selectedKey === k ? null : k); }}>
                  {chartData.map((d, i) => (
                    <Cell key={i}
                      fill={spec.groupBy === "category" ? catColor(d.key) : "var(--accent)"}
                      opacity={selectedKey && selectedKey !== d.key ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
          {selectedKey && (
            <div style={styles.filterChip}>
              filtered to <b>{fmtGroupKey(selectedKey, spec.groupBy)}</b>
              <span onClick={() => setSelectedKey(null)} style={styles.chipX}>&times;</span>
            </div>
          )}
        </div>
      )}

      <div style={styles.listWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: "18%" }}>Date</th>
              <th style={{ ...styles.th, width: "38%" }}>Payee</th>
              <th style={{ ...styles.th, width: "26%" }}>Category</th>
              <th style={{ ...styles.th, width: "18%", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((d, i) => (
              <tr
                key={i}
                className="tx-row"
                onMouseEnter={(e) => setHoverInfo({ row: d, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHoverInfo((h) => (h && h.row === d ? { ...h, x: e.clientX, y: e.clientY } : h))}
                onMouseLeave={() => setHoverInfo((h) => (h && h.row === d ? null : h))}
              >
                <td style={{ ...styles.td, ...styles.mono }}>{fmtDate(d.Date)}</td>
                <td style={styles.td}>{d.Payee}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.tag, background: catColor(d.Category) + "26", color: catColor(d.Category) }}>
                    {topCategory(d.Category)}
                  </span>
                </td>
                <td style={{ ...styles.td, ...styles.mono, textAlign: "right", color: d.Amount < 0 ? "var(--danger)" : "var(--accent)" }}>
                  {fmtMoney(d.Amount)}
                </td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr><td colSpan={4} style={{ ...styles.td, textAlign: "center", color: "var(--text-faint)" }}>No matching transactions</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {hoverInfo && <RowDetailPopover {...hoverInfo} />}
    </div>
  );
}

function LedgerDashboard({ accessToken, onSignOut }) {
  const [input, setInput] = useState("");
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const nextId = useRef(0);
  const scrollRef = useRef(null);

  const [dataStatus, setDataStatus] = useState("loading"); // "loading" | "ready" | "error"

  useEffect(() => {
    fetch("/api/transactions", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch transactions (${res.status})`);
        return res.json();
      })
      .then(rows => {
        loadData(cleanRows(rows));
        setDataStatus("ready");
      })
      .catch(() => setDataStatus("error"));
  }, []);

  async function runQuery(q) {
    if (!q.trim() || loading || dataStatus !== "ready") return;
    setLoading(true);
    const id = nextId.current++;
    setCards([{ id, question: q, spec: null, error: null, pending: true }]);
    setInput("");
    try {
      const resp = await fetch("/api/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ question: q }),
      });
      if (resp.status === 401) {
        // A stale/expired token isn't something rephrasing the question
        // fixes — drop back to the sign-in screen instead of showing a
        // confusing error card.
        onSignOut();
        return;
      }
      const data = await resp.json();
      const result = parseQueryResponse(resp.ok, data);
      setCards(prev => prev.map(c => c.id === id ? { ...c, ...result, pending: false } : c));
    } catch (e) {
      setCards(prev => prev.map(c => c.id === id ? { ...c, error: String(e.message || e), pending: false } : c));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <style>{`
        ::placeholder { color: var(--text-faint); }
        button:disabled { opacity: 0.3; cursor: default; }
        .tx-row:hover { background: var(--surface-recessed); }
        .recharts-wrapper *:focus:not(:focus-visible) { outline: none; }
      `}</style>

      <div style={styles.header}>
        <div style={styles.brand}>Analysis</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onSignOut}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "6px 12px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
          <ThemeToggle />
        </div>
      </div>

      {dataStatus === "loading" && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, fontFamily: "var(--font-body)" }}>
          Loading transaction data…
        </div>
      )}
      {dataStatus === "error" && (
        <div style={{ textAlign: "center", color: "var(--danger)", fontSize: 13, fontFamily: "var(--font-body)" }}>
          Couldn't load transaction data — check the Supabase connection.
        </div>
      )}

      <div style={styles.queryBar}>
        <div style={styles.inputWrap}>
          <input
            style={styles.input}
            value={input}
            placeholder={dataStatus === "ready" ? "" : "Loading…"}
            disabled={dataStatus !== "ready"}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runQuery(input)}
          />
          <button style={styles.askBtn} onClick={() => runQuery(input)} disabled={loading || dataStatus !== "ready"}>
            {loading ? "…" : "Ask"}
          </button>
        </div>
      </div>

      <div style={styles.feed} ref={scrollRef}>
        {cards.map(c => c.pending ? (
          <div key={c.id} style={styles.card}>
            <div style={styles.qLabel}>"{c.question}"</div>
            <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0" }}>thinking…</div>
          </div>
        ) : (
          <QueryCard key={c.id} {...c} onRemove={() => setCards(prev => prev.filter(x => x.id !== c.id))} />
        ))}
      </div>
    </div>
  );
}

// Top-level auth gate: renders the dashboard once signed in, otherwise
// the Google sign-in screen. All actual data isolation happens server-side
// (RLS on `transactions`, keyed off the access token forwarded to
// api/transactions.js) — this is just what decides which screen to show.
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  // undefined = checking, null = no linked bank yet, object = at least one plaid_items row
  const [plaidItem, setPlaidItem] = useState(undefined);
  const [skippedLink, setSkippedLink] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setPlaidItem(undefined);
      return;
    }
    const supabase = getSupabaseClient();
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .limit(1)
      .then(({ data, error }) => {
        // Fail open: an unreachable/broken link-status check shouldn't
        // block the dashboard. `false` is a distinct "unknown" sentinel
        // from null ("confirmed: no linked bank"), so it never triggers
        // the Link gate below.
        if (error) {
          console.error("Failed to check plaid_items", error);
          setPlaidItem(false);
          return;
        }
        setPlaidItem(data?.[0] ?? null);
      })
      .catch((err) => {
        console.error("Failed to check plaid_items", err);
        setPlaidItem(false);
      });
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (plaidItem === undefined) return null; // checking for a linked bank

  if (plaidItem === null && !skippedLink) {
    return (
      <PlaidLinkGate
        accessToken={session.access_token}
        onDone={() => setSkippedLink(true)}
      />
    );
  }

  return (
    <LedgerDashboard
      accessToken={session.access_token}
      onSignOut={() => getSupabaseClient().auth.signOut()}
    />
  );
}

