import { StyleSheet, Text, View } from "react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory } from "../lib/logic";
import type { Transaction } from "../lib/types";

// Shared by the Home screen's Recent Activity and Ask's QueryCard, same
// as src/TransactionRow.jsx on the web -- one place for how a row looks
// so both lists stay in sync. Inline editing (payee/category) isn't
// ported yet -- see mobile/README.md's phase list.
export default function TransactionRow({ row, CATS }: { row: Transaction; CATS: string[] }) {
  const color = catColor(row.Category, CATS, topCategory);
  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <Text style={styles.payee} numberOfLines={1}>
          {row.Payee}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.categoryBadge, { backgroundColor: color + "26" }]}>
            <Text style={[styles.categoryText, { color }]} numberOfLines={1}>
              {row.Category}
            </Text>
          </View>
          <Text style={styles.date}>{fmtDate(row.Date)}</Text>
        </View>
      </View>
      <Text style={[styles.amount, row.Amount < 0 && styles.negative]}>{fmtMoney(row.Amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  main: { flex: 1, marginRight: 12 },
  payee: { fontSize: 15, fontWeight: "500" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  categoryBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 },
  categoryText: { fontSize: 11, fontWeight: "600" },
  date: { fontSize: 12, color: "#888" },
  amount: { fontSize: 15, fontWeight: "600" },
  negative: { color: "#d33" },
});
