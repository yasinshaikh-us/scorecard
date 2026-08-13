import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Chart from "./Chart";
import TransactionRow from "./TransactionRow";
import { buildChartData, filterTransactions, groupKeyOf, type QueryResult } from "../lib/logic";
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

  const spec = "spec" in card ? card.spec : undefined;

  const baseFiltered = useMemo(() => filterTransactions(transactions, spec ?? null), [transactions, spec]);
  const chartData = useMemo(() => buildChartData(baseFiltered, spec ?? null), [baseFiltered, spec]);
  const displayed = useMemo(() => {
    if (!selectedKey || !spec) return baseFiltered;
    return baseFiltered.filter((d) => groupKeyOf(spec, d) === selectedKey);
  }, [baseFiltered, selectedKey, spec]);
  const sortedRows = useMemo(() => {
    if (spec?.groupBy === "transaction" && !selectedKey) {
      return chartData.map((c) => c.row!).filter(Boolean);
    }
    return displayed.slice().sort((a, b) => b.Date.localeCompare(a.Date));
  }, [displayed, selectedKey, spec, chartData]);

  function toggleSelect(key: string) {
    setSelectedKey((prev) => (prev === key ? null : key));
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

      {spec.chartType !== "none" && chartData.length > 0 && (
        <>
          <Chart data={chartData} spec={spec} CATS={CATS} selectedKey={selectedKey} onSelect={toggleSelect} />
          {selectedKey && (
            <Pressable style={[styles.filterChip, { backgroundColor: colors.surfaceRecessed }]} onPress={() => setSelectedKey(null)}>
              <Text style={[styles.filterChipText, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
                filtered to <Text style={{ fontFamily: fontFamily.bold }}>{selectedKey}</Text> ×
              </Text>
            </Pressable>
          )}
        </>
      )}

      <View>
        {sortedRows.map((d, i) => (
          <TransactionRow key={d.Id ?? i} row={d} CATS={CATS} onEdited={onTransactionEdited} />
        ))}
        {sortedRows.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>No matching transactions</Text>
        ) : null}
      </View>
    </View>
  );
}

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
  filterChip: {
    alignSelf: "center",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  filterChipText: { fontSize: 12 },
});
