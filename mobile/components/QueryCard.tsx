import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Chart from "./Chart";
import TransactionRow from "./TransactionRow";
import { buildChartData, filterTransactions, groupKeyOf, type QueryResult } from "../lib/logic";
import type { Transaction } from "../lib/types";

type Card = { id: number; question: string; pending?: boolean } & Partial<QueryResult>;

// One card in the Ask feed: pending "thinking…", an error, an off-topic
// rejection, or a real result (chart + matching transaction list) --
// mirrors src/QueryCard.jsx's four states.
export default function QueryCard({
  card,
  transactions,
  CATS,
  onRemove,
}: {
  card: Card;
  transactions: Transaction[];
  CATS: string[];
  onRemove: () => void;
}) {
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
      <View style={styles.card}>
        <Text style={styles.question}>"{card.question}"</Text>
        <Text style={styles.thinking}>thinking…</Text>
        <ActivityIndicator style={{ marginTop: 4 }} />
      </View>
    );
  }

  if ("error" in card && card.error) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.question}>"{card.question}"</Text>
          <Pressable onPress={onRemove} hitSlop={8}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.error}>Couldn't parse that one — try rephrasing. ({card.error})</Text>
      </View>
    );
  }

  if ("offTopic" in card && card.offTopic) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.question}>"{card.question}"</Text>
          <Pressable onPress={onRemove} hitSlop={8}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>
          This app only answers questions about your own bank-transaction ledger — try something like "how much did
          I spend on groceries last month?"
        </Text>
      </View>
    );
  }

  if (!spec) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.question}>"{card.question}"</Text>
          <Text style={styles.title}>{spec.title}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>

      {spec.chartType !== "none" && chartData.length > 0 && (
        <>
          <Chart data={chartData} spec={spec} CATS={CATS} selectedKey={selectedKey} onSelect={toggleSelect} />
          {selectedKey && (
            <Pressable style={styles.filterChip} onPress={() => setSelectedKey(null)}>
              <Text style={styles.filterChipText}>
                filtered to <Text style={{ fontWeight: "700" }}>{selectedKey}</Text> ×
              </Text>
            </Pressable>
          )}
        </>
      )}

      <View>
        {sortedRows.map((d, i) => (
          <TransactionRow key={d.Id ?? i} row={d} CATS={CATS} />
        ))}
        {sortedRows.length === 0 && <Text style={styles.empty}>No matching transactions</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
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
  question: { fontSize: 12, color: "#888", fontStyle: "italic" },
  title: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  close: { fontSize: 20, color: "#888", paddingHorizontal: 4 },
  thinking: { fontSize: 13, color: "#aaa", marginTop: 4 },
  error: { fontSize: 13, color: "#d33" },
  muted: { fontSize: 13, color: "#888" },
  empty: { textAlign: "center", color: "#888", paddingVertical: 16 },
  filterChip: {
    alignSelf: "center",
    backgroundColor: "#f2f2f2",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  filterChipText: { fontSize: 12, color: "#555" },
});
