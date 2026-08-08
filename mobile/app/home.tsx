import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabase";
import { functionUrl } from "../lib/functionsClient";
import { daysBefore, fmtDate, fmtMoney } from "../lib/format";
import type { Transaction } from "../lib/types";

const RECENT_DAYS = 7;

type Balance = { id: string; label: string; amount: number };

// Phase-1 mobile Home screen: account balance chips (read-only for now --
// linking/disconnecting a bank is Plaid SDK work, a later phase) + the
// last 7 days of transactions. Mirrors src/HomePage.jsx + src/AccountBalances.jsx's
// data shape and "recent" windowing (anchored to the ledger's own latest
// date, not device "now" -- see daysBefore's comment in the web app).
export default function Home() {
  const { session, loading: authLoading, signOut } = useAuth();

  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const [txResp, accountsRes, balancesRes] = await Promise.all([
        fetch(functionUrl("transactions"), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        supabase.from("plaid_accounts").select("account_id, item_id, name, mask"),
        supabase.from("plaid_account_balances").select("account_id, current, available"),
      ]);

      if (!txResp.ok) throw new Error(`Failed to fetch transactions (${txResp.status})`);
      setTransactions(await txResp.json());

      if (accountsRes.error || balancesRes.error) {
        setBalances([]);
      } else {
        const balanceByAccount: Record<string, { current: number | null; available: number | null }> = {};
        for (const b of balancesRes.data || []) balanceByAccount[b.account_id] = b;
        const rows = (accountsRes.data || [])
          .map((a): Balance | null => {
            const bal = balanceByAccount[a.account_id];
            const amount = bal?.current ?? bal?.available;
            if (amount == null) return null;
            return {
              id: a.account_id,
              label: `${a.name || "Account"}${a.mask ? ` ••${a.mask}` : ""}`,
              amount: Number(amount),
            };
          })
          .filter((b): b is Balance => b !== null);
        setBalances(rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong loading your data");
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (authLoading) return null;
  if (!session) return <Redirect href="/login" />;

  const ready = transactions !== null;
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
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Fathom</Text>
        <Pressable onPress={() => signOut()} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <FlatList
        data={recent}
        keyExtractor={(item, i) => String(item.Id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <BalancesRow balances={balances} />
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          </>
        }
        renderItem={({ item }) => <TransactionRow row={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {!ready ? "Loading…" : transactions && transactions.length === 0 ? "No transactions yet" : "Nothing in the last week"}
          </Text>
        }
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!ready && !error ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

function BalancesRow({ balances }: { balances: Balance[] | null }) {
  if (balances === null) return null;
  if (balances.length === 0) {
    return <Text style={styles.balancesEmpty}>No linked accounts yet</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.balancesRow}>
      {balances.map((b) => (
        <View key={b.id} style={styles.balanceChip}>
          <Text style={styles.balanceChipLabel} numberOfLines={1}>
            {b.label}
          </Text>
          <Text style={[styles.balanceChipAmount, b.amount < 0 && styles.negative]}>{fmtMoney(b.amount)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function TransactionRow({ row }: { row: Transaction }) {
  return (
    <View style={styles.txRow}>
      <View style={styles.txMain}>
        <Text style={styles.txPayee} numberOfLines={1}>
          {row.Payee}
        </Text>
        <Text style={styles.txCategory} numberOfLines={1}>
          {row.Category} · {fmtDate(row.Date)}
        </Text>
      </View>
      <Text style={[styles.txAmount, row.Amount < 0 && styles.negative]}>{fmtMoney(row.Amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  signOut: { color: "#1a73e8", fontSize: 14 },
  listContent: { paddingBottom: 24 },
  balancesRow: { paddingLeft: 16, marginBottom: 16 },
  balancesEmpty: { paddingHorizontal: 16, marginBottom: 16, color: "#888" },
  balanceChip: {
    backgroundColor: "#f2f2f2",
    borderRadius: 12,
    padding: 12,
    marginRight: 10,
    minWidth: 140,
  },
  balanceChipLabel: { fontSize: 12, color: "#666", marginBottom: 6 },
  balanceChipAmount: { fontSize: 18, fontWeight: "700" },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#666", paddingHorizontal: 16, marginBottom: 8 },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  txMain: { flex: 1, marginRight: 12 },
  txPayee: { fontSize: 15, fontWeight: "500" },
  txCategory: { fontSize: 13, color: "#888", marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: "600" },
  negative: { color: "#d33" },
  empty: { textAlign: "center", color: "#888", marginTop: 24 },
  error: { color: "#d33", textAlign: "center", padding: 12 },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
