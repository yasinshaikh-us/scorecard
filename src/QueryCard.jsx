import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { styles, tooltipStyle } from "./styles.js";
import { iconForCategory } from "./categoryIcons.js";
import { RAW_DATA, CATS } from "./dataStore.js";
import {
  topCategory, fmtDate, fmtGroupKey, fmtMoney,
  filterTransactions, groupKeyOf, buildChartData,
} from "./logic.js";

const PALETTE = ["#3FA796", "#C1666B", "#E8B04B", "#7B8FA1", "#9B6B9E", "#5C9DAD", "#B98B5E", "#6E9F7E", "#A65D5D", "#8F7EBA", "#5E8B7E", "#C97D60", "#4E8FA8", "#B0567A", "#7EA85E", "#A87E4E", "#6E7EBA", "#C9A05E", "#8E6E9F", "#5E9B8E", "#B87E8E", "#7E9BA8", "#A8945E", "#8E7E5E"];
const catColor = (cat) => PALETTE[CATS.indexOf(topCategory(cat)) % PALETTE.length];

function RowDetailPopover({ x, y, row }) {
  const left = Math.min(x + 14, window.innerWidth - 272);
  const top = Math.min(y + 14, window.innerHeight - 190);
  return (
    <div style={{ ...styles.rowDetailPopover, left, top }}>
      <div style={styles.rowDetailTitle}>{row.Payee}</div>
      {[
        ["Date", fmtDate(row.Date)],
        ["Amount", fmtMoney(row.Amount)],
        ["Category", row.Category],
        ["Account", row.Account],
      ].map(([label, value]) => (
        <div key={label} style={styles.rowDetailRow}>
          <span style={styles.rowDetailLabel}>{label}</span>
          <span style={styles.rowDetailValue}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export default function QueryCard({ id, question, spec, error, offTopic, onRemove }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  const baseFiltered = useMemo(() => filterTransactions(RAW_DATA, spec), [spec]);

  const chartData = useMemo(() => buildChartData(baseFiltered, spec), [baseFiltered, spec]);

  const displayed = useMemo(() => {
    if (!selectedKey) return baseFiltered;
    return baseFiltered.filter(d => groupKeyOf(spec, d) === selectedKey);
  }, [baseFiltered, selectedKey, spec]);

  const sortedRows = useMemo(() => {
    // groupBy "transaction" ranks individual transactions by size (see
    // buildChartData) -- when nothing's been clicked to drill in further,
    // the list below should show exactly that ranked/capped set, not an
    // unrelated date-sorted browse of every matching transaction.
    if (spec?.groupBy === "transaction" && !selectedKey) {
      return chartData.map((c) => c.row);
    }
    return displayed.slice().sort((a, b) => b.Date.localeCompare(a.Date));
  }, [displayed, selectedKey, spec, chartData]);

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

  // Merchant totals ("payee") and individual ranked transactions
  // ("transaction") both use long, variable-width text labels (payee
  // names, or "Payee — Date") -- neither fits the default horizontal-axis
  // bar layout used for short category/date labels.
  const longLabelChart = spec.groupBy === "payee" || spec.groupBy === "transaction";

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
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  isAnimationActive={false}
                  activeDot={false}
                  dot={(dotProps) => {
                    const { cx, cy, payload, index } = dotProps;
                    const isSelected = selectedKey === payload.key;
                    return (
                      <circle
                        key={`line-dot-${index}`}
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 5 : 4}
                        fill={isSelected ? "var(--accent)" : "var(--surface)"}
                        stroke="var(--accent)"
                        strokeWidth={2}
                        opacity={selectedKey && !isSelected ? 0.35 : 1}
                        cursor="pointer"
                        onClick={() => setSelectedKey(selectedKey === payload.key ? null : payload.key)}
                      />
                    );
                  }}
                />
              </LineChart>
            ) : (
              <BarChart data={chartData} layout={longLabelChart ? "vertical" : "horizontal"}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                {longLabelChart ? (
                  <>
                    <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
                    <YAxis type="category" dataKey="key" width={150} tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }} />
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
        {sortedRows.map((d, i) => {
          const Icon = iconForCategory(topCategory(d.Category));
          return (
            <div
              key={i}
              className="tx-row"
              style={styles.txRow}
              onMouseEnter={(e) => setHoverInfo({ row: d, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHoverInfo((h) => (h && h.row === d ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHoverInfo((h) => (h && h.row === d ? null : h))}
            >
              <div style={styles.txRowTop}>
                <div style={styles.txPayee}>{d.Payee}</div>
                <div style={styles.txRight}>
                  <span
                    title={d.Category}
                    aria-label={d.Category}
                    style={{ ...styles.categoryIconBadge, background: catColor(d.Category) + "26", color: catColor(d.Category) }}
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
        {sortedRows.length === 0 && <div style={styles.txEmpty}>No matching transactions</div>}
      </div>
      {hoverInfo && <RowDetailPopover {...hoverInfo} />}
    </div>
  );
}
