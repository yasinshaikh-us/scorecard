import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from "recharts";
import Papa from "papaparse";
import { styles, tooltipStyle } from "./styles.js";

let RAW_DATA = [];

const topCategory = (cat) => (cat || "Uncategorized").split(":")[0];

let CATS = [];
let SUBCATS = [];
let MIN_DATE = "";
let MAX_DATE = "";

// Called once the CSV has been fetched & parsed. Populates the module-level
// data + derived lookups that the rest of the app (and the system prompt) rely on.
function loadData(rows) {
  RAW_DATA = rows;
  CATS = [...new Set(RAW_DATA.map(d => topCategory(d.Category)))];
  SUBCATS = [...new Set(RAW_DATA.map(d => d.Category.trim()))].sort();
  if (RAW_DATA.length) {
    MIN_DATE = RAW_DATA.reduce((a, d) => d.Date < a ? d.Date : a, RAW_DATA[0].Date);
    MAX_DATE = RAW_DATA.reduce((a, d) => d.Date > a ? d.Date : a, RAW_DATA[0].Date);
  }
}

const PALETTE = ["#3FA796", "#C1666B", "#E8B04B", "#7B8FA1", "#9B6B9E", "#5C9DAD", "#B98B5E", "#6E9F7E", "#A65D5D", "#8F7EBA", "#5E8B7E", "#C97D60", "#4E8FA8", "#B0567A", "#7EA85E", "#A87E4E", "#6E7EBA", "#C9A05E", "#8E6E9F", "#5E9B8E", "#B87E8E", "#7E9BA8", "#A8945E", "#8E7E5E"];
const catColor = (cat) => PALETTE[CATS.indexOf(topCategory(cat)) % PALETTE.length];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  if (typeof iso !== "string" || !iso.includes("-")) return iso == null ? "" : String(iso);
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi] || isNaN(parseInt(d, 10))) return iso;
  const yy = y.slice(-2);
  return `${parseInt(d, 10)} ${MONTHS[mi]} ${yy}`;
};
const fmtMonth = (ym) => {
  if (typeof ym !== "string" || !ym.includes("-")) return ym == null ? "" : String(ym);
  const [y, m] = ym.split("-");
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi]) return ym;
  return `${MONTHS[mi]} ${y.slice(-2)}`;
};
const isDateKey = (groupBy) => groupBy === "day" || groupBy === "week" || groupBy === "month";
const fmtGroupKey = (k, groupBy) => groupBy === "month" ? fmtMonth(k) : (isDateKey(groupBy) ? fmtDate(k) : k);

const fmtMoney = (n) => {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function buildSystemPrompt() {
  return `You translate a question about a personal bank-transaction ledger into a strict JSON filter/chart spec. Never compute totals yourself.

Schema (columns): Date (YYYY-MM-DD), Payee (string), Amount (number, negative = money out / expense, positive = money in / income), Category (a "Top:Sub" string; top-level buckets are ${CATS.join(", ")}). Full list of exact Top:Sub category values present in the data: ${SUBCATS.join(", ")}.
Date range in data: ${MIN_DATE} to ${MAX_DATE}. Today's date is ${MAX_DATE} — treat this as "now" for any relative range (e.g. "last 72 days" means dateStart = today minus 72 days, dateEnd = today), and compute exact YYYY-MM-DD values yourself.

Return ONLY this JSON object, no markdown fences, no prose:
{
  "categories": [array of TOP-LEVEL category strings that match the question, or null for all],
  "categoryContains": "substring to match against the full Top:Sub category string, case-insensitive, or null",
  "payeeContains": "substring to match against Payee, case-insensitive, or null",
  "dateStart": "YYYY-MM-DD or null",
  "dateEnd": "YYYY-MM-DD or null",
  "type": "expense" | "income" | "all",
  "amountMin": number or null,
  "amountMax": number or null,
  "chartType": "bar" | "pie" | "line",
  "groupBy": "category" | "day" | "week" | "month" | "payee",
  "title": "short 3-8 word title for this view, in plain language"
}

Rules:
- Use "categories" for a broad top-level bucket (e.g. "food" -> Groceries + Dining & Drinks, "auto" -> Auto & Transport). Use "categoryContains" whenever the question names a specific kind of expense that is actually a SUBcategory rather than a whole top-level bucket — e.g. "rent" -> categoryContains "Rent" (matches "Home:Rent" only, excluding Mortgage/Alimony/other Home items); "mortgage" -> categoryContains "Mortgage"; "gas" for fuel -> categoryContains "Gas & Fuel"; "car insurance" -> categoryContains "Car Insurance". Check the full Top:Sub list above to find the exact subcategory term before deciding whether "categories" (top-level) or "categoryContains" (subcategory) is the right match — do not lump a specific subcategory request into its whole top-level bucket.
- Every query must produce a chart alongside the transaction list — never omit the chart, even for a simple list or yes/no question. If the question doesn't obviously imply a grouping (e.g. "just give me a list of X", "did I ever...", "show me the dates when..."), still pick the most informative default: chartType "bar" or "line" grouped by time (per the granularity rule below) if a date range or ongoing pattern is relevant, otherwise grouped by "category".
- If the question mentions a specific merchant/payee name, set payeeContains and leave categories null unless a category is also named.
- If the question is about spending/expenses, type="expense". About income/deposits/payroll, type="income". Otherwise "all".
- amountMin/amountMax filter on the transaction's magnitude (absolute value), regardless of sign. "less than $1,000" -> amountMax=1000. "more than $50" -> amountMin=50. "between $20 and $100" -> amountMin=20, amountMax=100. Leave null if the question has no dollar threshold.
- When the question is about spending/income over time (or any time-bounded list like "last year", "last N months"), choose the time-grouping granularity based on the span actually being covered — never default to "day":
  -- span under ~3 weeks (or no date range given, i.e. showing everything): groupBy "day"
  -- span from ~3 weeks up to ~4 months: groupBy "week"
  -- span longer than ~4 months (e.g. "last N months" where N >= 3, "this year", "over time" with a multi-year dataset): groupBy "month"
  -- Compute the span from dateStart/dateEnd (or the full data range if none given) and pick accordingly — a 7-month question should produce roughly 7 bars (month), not ~210 (day).
- Pick chartType/groupBy that best visualizes the question:
  -- Comparing a handful of named categories/groups as parts of a whole ("breakdown", "breakup", "split", "percentage", "share of spend", "versus" between categories) -> chartType "pie", groupBy "category" (or restrict via the categories field to just the named groups).
  -- Ranking or comparing many categories/merchants by raw magnitude ("top merchants", "which category do I spend the most on") -> chartType "bar", groupBy "category" or "payee".
  -- Spending/income over time, or any request scoped to a date range (e.g. "list of X over the last year") -> chartType "line" or "bar", groupBy chosen per the granularity rule above.
  -- A single-number, yes/no, or list-only question with no obvious time or category angle -> still default to chartType "bar", groupBy "category" (or "day"/"week"/"month" if a date range is implied) so a chart is always present.
- title should read naturally, e.g. "Dining spend by week" not "category=Dining".
- Respond with raw JSON only.`;
}

function QueryCard({ id, question, spec, error, onRemove }) {
  const [selectedKey, setSelectedKey] = useState(null);

  const baseFiltered = useMemo(() => {
    if (!spec) return [];
    return RAW_DATA.filter(d => {
      if (spec.categories && spec.categories.length && !spec.categories.includes(topCategory(d.Category))) return false;
      if (spec.categoryContains && !d.Category.toLowerCase().includes(spec.categoryContains.toLowerCase())) return false;
      if (spec.payeeContains && !d.Payee.toLowerCase().includes(spec.payeeContains.toLowerCase())) return false;
      if (spec.dateStart && d.Date < spec.dateStart) return false;
      if (spec.dateEnd && d.Date > spec.dateEnd) return false;
      if (spec.type === "expense" && d.Amount >= 0) return false;
      if (spec.type === "income" && d.Amount <= 0) return false;
      const mag = Math.abs(d.Amount);
      if (spec.amountMin != null && mag < spec.amountMin) return false;
      if (spec.amountMax != null && mag > spec.amountMax) return false;
      return true;
    });
  }, [spec]);

  const groupKeyOf = (d) => {
    if (!spec) return "";
    if (spec.groupBy === "category") return topCategory(d.Category);
    if (spec.groupBy === "payee") return d.Payee;
    if (spec.groupBy === "day") return d.Date;
    if (spec.groupBy === "month") return d.Date.slice(0, 7);
    if (spec.groupBy === "week") {
      const dt = new Date(d.Date + "T00:00:00");
      const day0 = new Date(dt);
      day0.setDate(dt.getDate() - dt.getDay());
      return day0.toISOString().slice(0, 10);
    }
    return "";
  };

  const chartData = useMemo(() => {
    if (!spec || spec.groupBy === "none") return [];
    const map = {};
    baseFiltered.forEach(d => {
      const k = groupKeyOf(d);
      if (!map[k]) map[k] = { key: k, total: 0, count: 0 };
      map[k].total += Math.abs(d.Amount);
      map[k].count += 1;
    });
    let arr = Object.values(map);
    if (spec.groupBy === "day" || spec.groupBy === "week" || spec.groupBy === "month") {
      arr.sort((a, b) => a.key.localeCompare(b.key));
    } else {
      arr.sort((a, b) => b.total - a.total);
    }
    if (spec.groupBy === "payee" && arr.length > 10) arr = arr.slice(0, 10);
    return arr;
  }, [baseFiltered, spec]);

  const displayed = useMemo(() => {
    if (!selectedKey) return baseFiltered;
    return baseFiltered.filter(d => groupKeyOf(d) === selectedKey);
  }, [baseFiltered, selectedKey]);

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
        <div style={{ color: "#C1666B", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: "8px 0" }}>
          Couldn't parse that one — try rephrasing. ({error})
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
                >
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={spec.groupBy === "category" ? catColor(d.key) : PALETTE[i % PALETTE.length]}
                      stroke={selectedKey === d.key ? "#EDE8DE" : "none"} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
              </PieChart>
            ) : spec.chartType === "line" ? (
              <LineChart data={chartData}>
                <CartesianGrid stroke="#2A313B" strokeDasharray="2 4" />
                <XAxis dataKey="key" tickFormatter={(k) => fmtGroupKey(k, spec.groupBy)} tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                <YAxis tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                <Tooltip labelFormatter={(k) => fmtGroupKey(k, spec.groupBy)} formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="total" stroke="#3FA796" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <BarChart data={chartData} layout={spec.groupBy === "payee" ? "vertical" : "horizontal"}>
                <CartesianGrid stroke="#2A313B" strokeDasharray="2 4" />
                {spec.groupBy === "payee" ? (
                  <>
                    <XAxis type="number" tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                    <YAxis type="category" dataKey="key" width={120} tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                  </>
                ) : (
                  <>
                    <XAxis dataKey="key" tickFormatter={(k) => fmtGroupKey(k, spec.groupBy)} tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                    <YAxis tick={{ fill: "#8B93A0", fontSize: 11, fontFamily: "Inter" }} />
                  </>
                )}
                <Tooltip labelFormatter={(k) => fmtGroupKey(k, spec.groupBy)} formatter={(v) => fmtMoney(v)} contentStyle={tooltipStyle} />
                <Bar dataKey="total" radius={[3, 3, 3, 3]} cursor="pointer"
                  onClick={(d) => { const k = d && (d.payload ? d.payload.key : d.key); if (k !== undefined) setSelectedKey(selectedKey === k ? null : k); }}>
                  {chartData.map((d, i) => (
                    <Cell key={i}
                      fill={spec.groupBy === "category" ? catColor(d.key) : "#3FA796"}
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
              <tr key={i}>
                <td style={styles.td}>{fmtDate(d.Date)}</td>
                <td style={styles.td}>{d.Payee}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.tag, background: catColor(d.Category) + "26", color: catColor(d.Category) }}>
                    {topCategory(d.Category)}
                  </span>
                </td>
                <td style={{ ...styles.td, textAlign: "right", fontFamily: "'Inter', sans-serif", color: d.Amount < 0 ? "#C1666B" : "#3FA796" }}>
                  {fmtMoney(d.Amount)}
                </td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr><td colSpan={4} style={{ ...styles.td, textAlign: "center", color: "#5A6270" }}>No matching transactions</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LedgerDashboard() {
  const [input, setInput] = useState("");
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const nextId = useRef(0);
  const scrollRef = useRef(null);

  const [dataStatus, setDataStatus] = useState("loading"); // "loading" | "ready" | "error"

  useEffect(() => {
    fetch("/data.csv")
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch data.csv (${res.status})`);
        return res.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          complete: (results) => {
            const rows = results.data
              .filter(r => r.Date && r.Payee && r.Category && r.Amount !== undefined && r.Amount !== "")
              .map(r => ({
                Date: String(r.Date).trim(),
                Payee: String(r.Payee).trim(),
                Category: String(r.Category).trim(),
                Amount: parseFloat(r.Amount),
              }))
              .filter(r => !isNaN(r.Amount));
            loadData(rows);
            setDataStatus("ready");
          },
          error: () => setDataStatus("error"),
        });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: q }],
        }),
      });
      const data = await resp.json();
      const textBlock = (data.content || []).find(b => b.type === "text");
      let raw = textBlock ? textBlock.text : "";
      raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      const spec = JSON.parse(raw);
      setCards(prev => prev.map(c => c.id === id ? { ...c, spec, pending: false } : c));
    } catch (e) {
      setCards(prev => prev.map(c => c.id === id ? { ...c, error: String(e.message || e), pending: false } : c));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #5A6270; }
        button:disabled { opacity: 0.3; cursor: default; }
      `}</style>

      <div style={styles.header}>
        <div style={styles.brand}>Analysis</div>
      </div>

      {dataStatus === "loading" && (
        <div style={{ textAlign: "center", color: "#8B93A0", fontSize: 13, fontFamily: "'Inter', sans-serif" }}>
          Loading transaction data…
        </div>
      )}
      {dataStatus === "error" && (
        <div style={{ textAlign: "center", color: "#C1666B", fontSize: 13, fontFamily: "'Inter', sans-serif" }}>
          Couldn't load data.csv — make sure it's in the public/ folder.
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
            <div style={{ color: "#5A6270", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: "8px 0" }}>thinking…</div>
          </div>
        ) : (
          <QueryCard key={c.id} {...c} onRemove={() => setCards(prev => prev.filter(x => x.id !== c.id))} />
        ))}
      </div>
    </div>
  );
}

