import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ArrowRight, FlaskConical, Landmark, Plus, Unlink, X } from "lucide-react-native";
import { useAuth, TEST_LOGIN_ENABLED } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { functionUrl } from "../lib/functionsClient";
import { fmtMoney } from "../lib/format";
import { useBankLink } from "../lib/useBankLink";
import IconButton from "./IconButton";

type Balance = { id: string; itemId: string; label: string; amount: number };
type DisconnectState = { itemId: string; label: string; siblingLabels: string[]; step: 1 | 2; submitting: boolean; error: string | null };

// Accounts-summary strip. Reads plaid_accounts + plaid_account_balances
// directly via the authenticated Supabase client (RLS-scoped, so no Edge
// Function is needed for reads), and owns the add-bank / disconnect flows via
// plaid-link-token / plaid-exchange (useBankLink) / plaid-disconnect.
//
// Disconnecting is a two-step, increasingly-worded confirmation on
// purpose -- unlike a category rule, this revokes real bank access and
// (per the 90-day retention policy) eventually deletes real transaction
// history for good.
export default function AccountBalances({ onLinked }: { onLinked?: () => void }) {
  const { session } = useAuth();
  const { colors } = useTheme();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [disconnect, setDisconnect] = useState<DisconnectState | null>(null);
  const [testLinking, setTestLinking] = useState(false);
  const [testLinkError, setTestLinkError] = useState<string | null>(null);

  const loadBalances = useCallback(async () => {
    const [accountsRes, balancesRes] = await Promise.all([
      supabase.from("plaid_accounts").select("account_id, item_id, name, mask"),
      supabase.from("plaid_account_balances").select("account_id, current, available"),
    ]);
    if (accountsRes.error || balancesRes.error) {
      setBalances([]);
      return;
    }
    const balanceByAccount: Record<string, { current: number | null; available: number | null }> = {};
    for (const b of balancesRes.data || []) balanceByAccount[b.account_id] = b;
    const rows = (accountsRes.data || [])
      .map((a): Balance | null => {
        const bal = balanceByAccount[a.account_id];
        const amount = bal?.current ?? bal?.available;
        if (amount == null) return null;
        return {
          id: a.account_id,
          itemId: a.item_id,
          label: `${a.name || "Account"}${a.mask ? ` ••${a.mask}` : ""}`,
          amount: Number(amount),
        };
      })
      .filter((b): b is Balance => b !== null);
    setBalances(rows);
  }, []);

  useEffect(() => {
    loadBalances();
  }, [loadBalances, refreshKey]);

  const { startLink, connecting, error: linkError } = useBankLink(() => {
    setRefreshKey((k) => k + 1);
    onLinked?.();
  });

  if (!balances) return <ActivityIndicator style={styles.loading} color={colors.accent} />;

  function startDisconnect(account: Balance) {
    const siblingLabels = (balances || [])
      .filter((b) => b.itemId === account.itemId && b.id !== account.id)
      .map((b) => b.label);
    setDisconnect({ itemId: account.itemId, label: account.label, siblingLabels, step: 1, submitting: false, error: null });
  }

  async function confirmDisconnect() {
    if (!disconnect || !session) return;
    setDisconnect((d) => (d ? { ...d, submitting: true, error: null } : d));
    try {
      const resp = await fetch(functionUrl("plaid-disconnect"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: disconnect.itemId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || "Couldn't disconnect — try again");
      }
      setDisconnect(null);
      setRefreshKey((k) => k + 1);
      onLinked?.();
    } catch (e) {
      setDisconnect((d) => (d ? { ...d, submitting: false, error: e instanceof Error ? e.message : "Couldn't disconnect" } : d));
    }
  }

  // Seeds a Plaid Sandbox-linked bank account via the test-plaid-link
  // Edge Function instead of driving Plaid Link's own hosted UI, which
  // this app doesn't own and can't reliably script (native WebView
  // content, no stable testIDs to match against) -- see
  // mobile/README.md's "Test Plaid Link" section and Detox's own
  // e2e/testPlaidLink.test.js. Only rendered in development/preview
  // builds, same gate as the "Sign in as test user" link.
  async function startTestLink() {
    if (!session) return;
    setTestLinking(true);
    setTestLinkError(null);
    try {
      const secret = process.env.EXPO_PUBLIC_TEST_PLAID_LINK_SECRET;
      if (!secret) throw new Error("Test Plaid link isn't enabled in this build.");

      const resp = await fetch(functionUrl("test-plaid-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ secret }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || "Test Plaid link failed");
      }
      setRefreshKey((k) => k + 1);
      onLinked?.();
    } catch (e) {
      setTestLinkError(e instanceof Error ? e.message : "Test Plaid link failed");
    } finally {
      setTestLinking(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerLabelRow}>
          <Landmark size={14} color={colors.textMuted} />
          <Text style={[styles.headerLabel, { color: colors.textMuted, fontFamily: fontFamily.semibold }]}>Banks</Text>
        </View>
        {/* Add sits on the block, not on any one bank: it adds an
            institution, while unlink acts on the row it sits in. */}
        <View style={styles.headerButtons}>
          {TEST_LOGIN_ENABLED ? (
            <IconButton
              testID="test-plaid-link-button"
              onPress={startTestLink}
              disabled={testLinking}
              size={28}
              accessibilityLabel={testLinking ? "Linking test bank" : "Link test bank"}
            >
              {testLinking ? (
                <ActivityIndicator size="small" color={colors.textFaint} />
              ) : (
                <FlaskConical size={13} color={colors.textFaint} />
              )}
            </IconButton>
          ) : null}
          {!showConfirm && !disconnect && (
            <IconButton
              testID="add-bank-button"
              onPress={() => setShowConfirm(true)}
              disabled={connecting}
              size={28}
              accessibilityLabel="Add bank"
            >
              {connecting ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Plus size={14} color={colors.textMuted} strokeWidth={2.2} />
              )}
            </IconButton>
          )}
        </View>
      </View>

      {/* One card, one row per account. The previous horizontal chip
          strip put a scroll gesture between the user and their own
          balances -- with three banks linked, the third was off-screen
          with nothing indicating it existed. Rows cascade downward
          instead, so account N+1 costs vertical space rather than
          discoverability, and every amount lands in the same right-hand
          column where they can be compared at a glance. */}
      {balances.length > 0 ? (
        <View style={[styles.bankCard, { backgroundColor: colors.surface }]}>
          {balances.map((b, i) => (
            <View
              key={b.id}
              testID="linked-account-row"
              style={[
                styles.bankRow,
                { borderBottomColor: colors.borderSubtle },
                i === balances.length - 1 ? styles.bankRowLast : null,
              ]}
            >
              <Text style={[styles.bankLabel, { color: colors.textMuted, fontFamily: fontFamily.regular }]} numberOfLines={1}>
                {b.label}
              </Text>
              <Text
                style={[
                  styles.bankAmount,
                  { color: b.amount < 0 ? colors.danger : colors.text, fontFamily: fontFamily.mono },
                ]}
              >
                {fmtMoney(b.amount)}
              </Text>
              <IconButton
                testID="disconnect-button"
                onPress={() => startDisconnect(b)}
                size={28}
                accessibilityLabel={`Disconnect ${b.label}`}
              >
                <Unlink size={14} color={colors.danger} />
              </IconButton>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>No linked accounts yet</Text>
      )}

      {showConfirm && (
        <View style={[styles.confirmBanner, { backgroundColor: colors.surfaceRecessed, borderColor: colors.border }]}>
          <Text style={[styles.confirmText, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
            Only checking / savings accounts can be connected.
          </Text>
          <View style={styles.confirmActions}>
            <IconButton
              testID="add-bank-cancel-button"
              onPress={() => setShowConfirm(false)}
              size={36}
              accessibilityLabel="Cancel adding a bank"
            >
              <X size={17} color={colors.textMuted} />
            </IconButton>
            <IconButton
              testID="add-bank-proceed-button"
              onPress={() => {
                setShowConfirm(false);
                startLink();
              }}
              disabled={connecting}
              size={36}
              variant="accent"
              accessibilityLabel={connecting ? "Connecting" : "Continue to Plaid"}
            >
              {connecting ? <ActivityIndicator size="small" color={colors.bg} /> : <ArrowRight size={18} color={colors.bg} />}
            </IconButton>
          </View>
        </View>
      )}

      {disconnect && disconnect.step === 1 && (
        <View style={[styles.confirmBanner, { backgroundColor: colors.surfaceRecessed, borderColor: colors.border }]}>
          <Text style={[styles.confirmText, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
            Disconnect {disconnect.label}? This stops new transactions from syncing.
            {disconnect.siblingLabels.length > 0
              ? ` This will also disconnect ${disconnect.siblingLabels.join(", ")}, since they share the same bank connection.`
              : ""}{" "}
            Existing transaction history is kept for 90 days in case you reconnect, then permanently deleted.
          </Text>
          <View style={styles.confirmActions}>
            <IconButton
              testID="disconnect-cancel-button"
              onPress={() => setDisconnect(null)}
              size={36}
              accessibilityLabel="Keep this bank connected"
            >
              <X size={17} color={colors.textMuted} />
            </IconButton>
            {/* Step 1 only advances, so it takes the neutral arrow. The
                unlink glyph is held back for step 2, where the tap
                actually disconnects. */}
            <IconButton
              testID="disconnect-continue-button"
              onPress={() => setDisconnect((d) => (d ? { ...d, step: 2 } : d))}
              size={36}
              variant="accent"
              accessibilityLabel="Continue to the final disconnect confirmation"
            >
              <ArrowRight size={18} color={colors.bg} />
            </IconButton>
          </View>
        </View>
      )}

      {disconnect && disconnect.step === 2 && (
        <View style={[styles.confirmBannerFinal, { backgroundColor: colors.surfaceRecessed, borderColor: colors.danger }]}>
          <Text style={[styles.confirmText, { color: colors.text, fontFamily: fontFamily.regular }]}>
            <Text style={{ fontFamily: fontFamily.bold }}>Are you absolutely sure?</Text> This can't be undone from the
            app — you'd need to reconnect {disconnect.siblingLabels.length > 0 ? "these accounts" : "this account"}{" "}
            through Plaid to restore access, and after 90 days any transaction history that isn't reconnected is gone
            for good.
          </Text>
          {/* The one place in the app where a glyph carries an
              irreversible action. It gets the danger fill, the unlink
              mark rather than a generic arrow, and -- since the label
              that used to name the account is gone -- an
              accessibilityLabel that still names it. */}
          <View style={styles.confirmActions}>
            <IconButton
              testID="disconnect-final-cancel-button"
              onPress={() => setDisconnect(null)}
              disabled={disconnect.submitting}
              size={36}
              accessibilityLabel="Keep this bank connected"
            >
              <X size={17} color={colors.textMuted} />
            </IconButton>
            <IconButton
              testID="disconnect-confirm-button"
              onPress={confirmDisconnect}
              disabled={disconnect.submitting}
              size={36}
              variant="danger"
              accessibilityLabel={
                disconnect.submitting ? "Disconnecting" : `Yes, permanently disconnect ${disconnect.label}`
              }
            >
              {disconnect.submitting ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Unlink size={18} color={colors.bg} />
              )}
            </IconButton>
          </View>
          {disconnect.error ? (
            <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{disconnect.error}</Text>
          ) : null}
        </View>
      )}
      {linkError ? <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{linkError}</Text> : null}
      {testLinkError ? (
        <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{testLinkError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately more than the gap between rows inside either block: the
  // banks and the activity list are different kinds of thing, and at 16
  // they read as one continuous list.
  wrap: { marginBottom: 26 },
  loading: { marginVertical: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
  headerLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  empty: { paddingHorizontal: 16 },
  bankCard: { marginHorizontal: 16, borderRadius: 12, overflow: "hidden" },
  bankRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  bankRowLast: { borderBottomWidth: 0 },
  bankLabel: { flex: 1, minWidth: 0, fontSize: 13 },
  bankAmount: { flexBasis: 96, flexGrow: 0, flexShrink: 0, textAlign: "right", fontSize: 15, fontWeight: "700" },
  confirmBanner: { borderWidth: 1, borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 10 },
  confirmBannerFinal: { borderWidth: 1, borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 10 },
  confirmText: { fontSize: 13, lineHeight: 18 },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 10 },
  error: { fontSize: 12, marginTop: 8, paddingHorizontal: 16 },
});
