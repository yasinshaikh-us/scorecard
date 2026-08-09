import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/AuthProvider";
import { useData } from "../../lib/DataProvider";
import { daysBefore } from "../../lib/format";
import TransactionRow from "../../components/TransactionRow";
import AccountBalances from "../../components/AccountBalances";
import CategoryRulesPanel from "../../components/CategoryRulesPanel";

const RECENT_DAYS = 7;

// Home screen: account balances (AccountBalances, own add/disconnect
// flow) + the last 7 days of transactions -- mirrors src/HomePage.jsx's
// "recent" windowing (anchored to the ledger's own latest date, not
// device "now" -- see daysBefore's comment in the web app). Transaction
// data comes from DataProvider (shared with the Ask screen).
export default function Home() {
  const { signOut } = useAuth();
  const { transactions, dataStatus, CATS, refresh } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const ready = dataStatus === "ready";
  const recent = ready
    ? (() => {
        if (transactions.length === 0) return [];
        const maxDate = transactions.reduce((a, d) => (d.Date > a ? d.Date : a), transactions[0].Date);
        const cutoff = daysBefore(maxDate, RECENT_DAYS);
        return transactions
          .filter((d) => d.Date >= cutoff)
          .slice()
          .sort((a, b) => b.Date.localeCompare(a.Date));
      })()
    : [];

  return (
    <SafeAreaView testID="home-screen" style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Fathom</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setRulesOpen(true)} hitSlop={8}>
            <Text style={styles.headerAction}>Rules</Text>
          </Pressable>
          <Pressable onPress={() => signOut()} hitSlop={8}>
            <Text style={styles.headerAction}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={recent}
        keyExtractor={(item, i) => String(item.Id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <AccountBalances onLinked={refresh} />
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          </>
        }
        renderItem={({ item }) => <TransactionRow row={item} CATS={CATS} onEdited={refresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {!ready ? "Loading…" : transactions.length === 0 ? "No transactions yet" : "Nothing in the last week"}
          </Text>
        }
      />

      {dataStatus === "error" ? <Text style={styles.error}>Couldn't load transaction data</Text> : null}
      {!ready && dataStatus !== "error" ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      ) : null}

      <CategoryRulesPanel visible={rulesOpen} onClose={() => setRulesOpen(false)} onApplied={refresh} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerActions: { flexDirection: "row", gap: 16 },
  headerAction: { color: "#1a73e8", fontSize: 14 },
  listContent: { paddingBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#666", paddingHorizontal: 16, marginBottom: 8 },
  empty: { textAlign: "center", color: "#888", marginTop: 24 },
  error: { color: "#d33", textAlign: "center", padding: 12 },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
