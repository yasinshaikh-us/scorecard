import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useData } from "../../lib/DataProvider";
import { useTheme } from "../../lib/ThemeProvider";
import { fontFamily } from "../../lib/theme";
import { daysBefore } from "../../lib/format";
import TransactionRow from "../../components/TransactionRow";
import AccountBalances from "../../components/AccountBalances";
import CategoryRulesPanel from "../../components/CategoryRulesPanel";
import ScreenHeader from "../../components/ScreenHeader";

const RECENT_DAYS = 7;

// Home screen: account balances (AccountBalances, own add/disconnect
// flow) + the last 7 days of transactions. The "recent" window is
// anchored to the ledger's own latest date rather than device "now" --
// see daysBefore in lib/logic.ts -- so a stale ledger still shows its
// most recent activity instead of an empty list. Transaction data comes
// from DataProvider (shared with the Ask screen).
export default function Home() {
  const { transactions, dataStatus, CATS, refresh } = useData();
  const { colors } = useTheme();
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
    <SafeAreaView testID="home-screen" style={[styles.screen, { backgroundColor: colors.bg }]} edges={["top"]}>
      <ScreenHeader onOpenRules={() => setRulesOpen(true)} />

      <FlatList
        testID="home-transaction-list"
        data={recent}
        keyExtractor={(item, i) => String(item.Id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <AccountBalances onLinked={refresh} />
            <Text
              testID="recent-activity-header"
              style={[styles.sectionTitle, { color: colors.textMuted, fontFamily: fontFamily.semibold }]}
            >
              Recent Activity
            </Text>
          </>
        }
        renderItem={({ item }) => <TransactionRow row={item} CATS={CATS} onEdited={refresh} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>
            {!ready ? "Loading…" : transactions.length === 0 ? "No transactions yet" : "Nothing in the last week"}
          </Text>
        }
      />

      {dataStatus === "error" ? (
        <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>
          Couldn't load transaction data
        </Text>
      ) : null}
      {!ready && dataStatus !== "error" ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      <CategoryRulesPanel visible={rulesOpen} onClose={() => setRulesOpen(false)} onApplied={refresh} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  empty: { textAlign: "center", marginTop: 24 },
  error: { textAlign: "center", padding: 12 },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
