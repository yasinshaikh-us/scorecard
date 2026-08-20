import { StyleSheet, Text, View } from "react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import type { BudgetProgress, Comparison, Outlier, Projection, QuerySummary } from "../lib/logic";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

// The scalar answer, which the card never had.
//
// "How much did I spend at Chipotle?" is a question about one number, and
// until now the only place that number appeared was as the height of a
// bar -- readable to the nearest gridline, if you squinted. Worse, a
// question with no date range silently covers the whole ledger, so a
// six-year total was presented with nothing on screen saying so.
//
// So every result now leads with total, count and average, over an
// explicitly named span. The chart went back to doing what a chart is
// for: shape over time, not a value lookup.

// "6 yrs" past two years, "18 months" below that -- the point is the
// order of magnitude of the window, not a precise duration.
export function fmtSpan(summary: QuerySummary) {
  const range = `${fmtDate(summary.start)} – ${fmtDate(summary.end)}`;
  if (summary.months >= 24) {
    const years = summary.months / 12;
    return `${range} · ${years >= 10 ? Math.round(years) : years.toFixed(1)} yrs`;
  }
  return `${range} · ${Math.max(Math.round(summary.months), 1)} mo`;
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text
        testID={testID}
        style={[styles.value, { color: colors.text, fontFamily: fontFamily.mono }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.label, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>{label}</Text>
    </View>
  );
}

export default function QueryStats({
  summary,
  outlier,
  comparison,
  budget,
  projection,
}: {
  summary: QuerySummary;
  outlier: Outlier | null;
  comparison?: Comparison | null;
  budget?: BudgetProgress | null;
  projection?: Projection | null;
}) {
  const { colors } = useTheme();
  // Up is not automatically bad (income) and down is not automatically
  // good, so the delta is coloured by direction only, not by judgement.
  const delta = comparison?.deltaPct ?? null;

  return (
    <View testID="query-stats" style={styles.wrap}>
      <View style={[styles.row, { backgroundColor: colors.surfaceRecessed }]}>
        <Stat testID="query-stat-total" label="total" value={fmtMoney(summary.sum)} />
        <Stat testID="query-stat-count" label={summary.count === 1 ? "transaction" : "transactions"} value={`${summary.count}`} />
        <Stat testID="query-stat-average" label="average" value={fmtMoney(summary.average)} />
      </View>
      <Text style={[styles.span, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>{fmtSpan(summary)}</Text>

      {comparison ? (
        <Text
          testID="query-stats-comparison"
          style={[styles.compare, { color: colors.textMuted, fontFamily: fontFamily.regular }]}
        >
          {delta === null
            ? `nothing in the previous ${fmtDate(comparison.start)} – ${fmtDate(comparison.end)}`
            : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(delta * 100))}% vs ${fmtMoney(comparison.sum)} the previous period`}
        </Text>
      ) : null}

      {projection ? (
        // Deliberately hedged wording: this is the window's own rate
        // carried forward, not a forecast of anything.
        <Text
          testID="query-stats-projection"
          style={[styles.compare, { color: colors.textMuted, fontFamily: fontFamily.regular }]}
        >
          at this pace, ~{fmtMoney(projection.projected)} by {fmtDate(projection.windowEnd)}
        </Text>
      ) : null}

      {budget ? (
        <Text
          testID="query-stats-budget"
          style={[styles.compare, { color: colors.textMuted, fontFamily: fontFamily.regular }]}
        >
          {fmtMoney(budget.spent)} of {fmtMoney(budget.target)} · {Math.round(budget.pct * 100)}%
          {budget.elapsedPct === null
            ? ""
            : budget.pct > budget.elapsedPct
              ? ` · ahead of pace (${Math.round(budget.elapsedPct * 100)}% through)`
              : ` · on track (${Math.round(budget.elapsedPct * 100)}% through)`}
        </Text>
      ) : null}
      {outlier ? (
        // Without this, one $170,000 Investments row reads as a month when
        // spending tripled rather than as a single purchase -- and every
        // other bar in the chart is a sliver against it.
        <Text
          testID="query-stats-outlier"
          style={[styles.outlier, { color: colors.textMuted, fontFamily: fontFamily.regular }]}
        >
          {outlier.rows === 1 ? "1 transaction is" : `${outlier.rows} transactions are`}{" "}
          {Math.round(outlier.share * 100)}% of this — {outlier.payee}, {fmtMoney(outlier.amount)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: "row", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 8 },
  stat: { flex: 1, minWidth: 0, alignItems: "center", gap: 2 },
  value: { fontSize: 15 },
  label: { fontSize: 10, textTransform: "lowercase" },
  span: { fontSize: 11, textAlign: "center", marginTop: 6 },
  compare: { fontSize: 11, textAlign: "center", marginTop: 6 },
  outlier: { fontSize: 11, textAlign: "center", marginTop: 6 },
});
