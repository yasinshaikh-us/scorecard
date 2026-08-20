import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Chart from "./Chart";
import TransactionRow from "./TransactionRow";
import QueryStats from "./QueryStats";
import {
  budgetProgress,
  buildChartData,
  buildSeriesData,
  forecastBuckets,
  projectRunRate,
  seriesKeyOf,
  comparePrevious,
  filterRecurring,
  filterTransactions,
  findOutlier,
  groupKeyOf,
  resolveSpec,
  summarize,
  type QueryResult,
} from "../lib/logic";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import type { Transaction } from "../lib/types";

type Card = { id: number; question: string; pending?: boolean } & Partial<QueryResult>;

// One card in the Ask feed: pending "thinking…", an error, an off-topic
// rejection, or a real result (chart + matching transaction list) -- four
// states, one component.
export default function QueryCard({
  card,
  transactions,
  CATS,
  onRemove,
  onTransactionEdited,
}: {
  card: Card;
  transactions: Transaction[];
  CATS: string[];
  onRemove: () => void;
  onTransactionEdited?: () => void;
}) {
  const { colors } = useTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A second selection axis, for the second grouping dimension: tapping a
  // legend entry narrows to that band, tapping a bar still narrows to
  // that bucket. One at a time -- two simultaneous filters on a card this
  // size is more state than it is worth.
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);

  const spec = "spec" in card ? card.spec : undefined;
  const issues = "issues" in card && card.issues ? card.issues : [];

  const baseFiltered = useMemo(
    // Recurrence is a property of a payee's history rather than of a row,
    // so a "what am I subscribed to" question narrows the set after the
    // row-wise filter has run.
    () => filterRecurring(filterTransactions(transactions, spec ?? null), spec ?? null),
    [transactions, spec]
  );
  // Not the spec the model returned: a grouping that collapses to a
  // single bucket is re-grouped over time here (see resolveSpec), so
  // everything downstream -- chart, labels, tap-to-filter -- has to read
  // from the resolved one or they disagree about what a bucket is.
  const chartSpec = useMemo(() => resolveSpec(baseFiltered, spec ?? null), [baseFiltered, spec]);
  // The ledger's own last date is "today" everywhere in this card: the
  // system prompt anchors relative ranges to it too, so a projection and
  // the question that asked for it agree on when now is.
  const today = useMemo(
    () => transactions.reduce((latest, d) => (d.Date > latest ? d.Date : latest), ""),
    [transactions]
  );
  const chartData = useMemo(
    () => forecastBuckets(buildChartData(baseFiltered, chartSpec), chartSpec, today),
    [baseFiltered, chartSpec, today]
  );
  const seriesData = useMemo(() => buildSeriesData(baseFiltered, chartSpec), [baseFiltered, chartSpec]);
  const summary = useMemo(() => summarize(baseFiltered), [baseFiltered]);
  const outlier = useMemo(() => findOutlier(baseFiltered), [baseFiltered]);
  // Against the whole ledger, not the filtered set: the previous window's
  // rows are by definition outside this one's date bounds.
  const comparison = useMemo(
    () => comparePrevious(transactions, spec ?? null, summary),
    [transactions, spec, summary]
  );
  const budget = useMemo(() => budgetProgress(summary, spec ?? null), [summary, spec]);
  const projection = useMemo(() => projectRunRate(summary, spec ?? null, today), [summary, spec, today]);
  const displayed = useMemo(() => {
    if (!chartSpec) return baseFiltered;
    if (selectedSeries) {
      // "Other" on a legend stands for the series it folded in, same as
      // the pie's own Other slice.
      const band = seriesData?.series.find((s) => s.name === selectedSeries);
      const names = band?.keys ?? [selectedSeries];
      return baseFiltered.filter((d) => names.includes(seriesKeyOf(chartSpec, d)));
    }
    if (!selectedKey) return baseFiltered;
    // A capped pie's "Other" slice stands for several group keys at once,
    // so selection matches against the set it swallowed rather than
    // against its own label, which belongs to no transaction.
    const selected = chartData.find((c) => c.key === selectedKey);
    const keys = selected?.keys ?? [selectedKey];
    return baseFiltered.filter((d) => keys.includes(groupKeyOf(chartSpec, d)));
  }, [baseFiltered, selectedKey, selectedSeries, chartSpec, chartData, seriesData]);
  const sortedRows = useMemo(() => {
    if (chartSpec?.groupBy === "transaction" && !selectedKey) {
      return chartData.map((c) => c.row!).filter(Boolean);
    }
    return displayed.slice().sort((a, b) => b.Date.localeCompare(a.Date));
  }, [displayed, selectedKey, chartSpec, chartData]);
  // Every matching row used to be mounted at once, so "show me
  // everything" built six thousand row components inside a ScrollView.
  // A FlatList is not the fix here -- nesting one inside the Ask
  // screen's own ScrollView breaks its windowing and warns -- so the
  // list is bounded instead, and says so rather than pretending the
  // ledger ends at row 200.
  const visibleRows = useMemo(() => sortedRows.slice(0, ROW_CAP), [sortedRows]);

  function toggleSelect(key: string) {
    setSelectedSeries(null);
    setSelectedKey((prev) => (prev === key ? null : key));
  }

  function toggleSeries(name: string) {
    setSelectedKey(null);
    setSelectedSeries((prev) => (prev === name ? null : name));
  }

  if (card.pending) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.question, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>"{card.question}"</Text>
        <Text style={[styles.thinking, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>thinking…</Text>
        <ActivityIndicator style={{ marginTop: 4 }} color={colors.accent} />
      </View>
    );
  }

  if ("error" in card && card.error) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.question, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>"{card.question}"</Text>
          <Pressable testID="query-card-close-button" onPress={onRemove} hitSlop={8}>
            <Text style={[styles.close, { color: colors.textMuted }]}>×</Text>
          </Pressable>
        </View>
        <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>
          Couldn't parse that one — try rephrasing. ({card.error})
        </Text>
      </View>
    );
  }

  if ("offTopic" in card && card.offTopic) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.question, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>"{card.question}"</Text>
          <Pressable testID="query-card-close-button" onPress={onRemove} hitSlop={8}>
            <Text style={[styles.close, { color: colors.textMuted }]}>×</Text>
          </Pressable>
        </View>
        <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
          This app only answers questions about your own bank-transaction ledger — try something like "how much did
          I spend on groceries last month?"
        </Text>
      </View>
    );
  }

  if (!spec) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.question, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>"{card.question}"</Text>
          <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.semibold }]}>{spec.title}</Text>
        </View>
        <Pressable testID="query-card-close-button" onPress={onRemove} hitSlop={8}>
          <Text style={[styles.close, { color: colors.textMuted }]}>×</Text>
        </Pressable>
      </View>

      {issues.length > 0 ? (
        <Text
          testID="query-card-issues"
          style={[styles.issues, { color: colors.textMuted, fontFamily: fontFamily.regular }]}
        >
          Adjusted this question: {issues.join("; ")}.
        </Text>
      ) : null}

      {summary ? (
        <QueryStats summary={summary} outlier={outlier} comparison={comparison} budget={budget} projection={projection} />
      ) : null}

      {chartSpec && chartSpec.chartType !== "none" && chartData.length > 0 && (
        <>
          <Chart
            data={chartData}
            spec={chartSpec}
            CATS={CATS}
            seriesData={seriesData}
            selectedKey={selectedKey}
            selectedSeries={selectedSeries}
            onSelect={toggleSelect}
            onSelectSeries={toggleSeries}
          />
          {(selectedKey || selectedSeries) && (
            <Pressable
              style={[styles.filterChip, { backgroundColor: colors.surfaceRecessed }]}
              onPress={() => {
                setSelectedKey(null);
                setSelectedSeries(null);
              }}
            >
              <Text style={[styles.filterChipText, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
                filtered to <Text style={{ fontFamily: fontFamily.bold }}>{selectedSeries ?? selectedKey}</Text> ×
              </Text>
            </Pressable>
          )}
        </>
      )}

      <View>
        {visibleRows.map((d, i) => (
          <TransactionRow key={d.Id ?? i} row={d} CATS={CATS} onEdited={onTransactionEdited} />
        ))}
        {sortedRows.length > visibleRows.length ? (
          <Text
            testID="query-row-cap"
            style={[styles.muted, styles.rowCap, { color: colors.textFaint, fontFamily: fontFamily.regular }]}
          >
            showing {visibleRows.length} of {sortedRows.length} — narrow the question to see the rest
          </Text>
        ) : null}
        {sortedRows.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>No matching transactions</Text>
        ) : null}
      </View>
    </View>
  );
}

// One card renders one screenful plus scroll, not a whole ledger.
const ROW_CAP = 200;

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  question: { fontSize: 12, fontStyle: "italic" },
  title: { fontSize: 16, marginTop: 2 },
  close: { fontSize: 20, paddingHorizontal: 4 },
  thinking: { fontSize: 13, marginTop: 4 },
  error: { fontSize: 13 },
  muted: { fontSize: 13 },
  empty: { textAlign: "center", paddingVertical: 16 },
  rowCap: { textAlign: "center", paddingVertical: 12, fontSize: 11 },
  issues: { fontSize: 11, marginBottom: 8 },
  filterChip: {
    alignSelf: "center",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  filterChipText: { fontSize: 12 },
});
