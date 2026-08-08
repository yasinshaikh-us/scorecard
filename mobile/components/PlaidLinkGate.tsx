import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBankLink } from "../lib/useBankLink";

// Shown once, between sign-in and the dashboard, the first time a user
// has no linked bank -- mirrors src/PlaidLinkGate.jsx. Skippable, never
// blocks access. Banks can also be added later via the "+ Add bank"
// button on Home, which shares this same useBankLink hook.
export default function PlaidLinkGate({ onDone }: { onDone: () => void }) {
  const { startLink, connecting, error } = useBankLink(onDone);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Connect your bank</Text>
      <Text style={styles.body}>
        Link a bank account so new transactions and balances sync in automatically. You can always add this later.
      </Text>

      <Pressable style={[styles.connectBtn, connecting && styles.disabled]} onPress={startLink} disabled={connecting}>
        <Text style={styles.connectBtnText}>{connecting ? "Connecting…" : "Connect a bank account"}</Text>
      </Pressable>

      <Pressable onPress={onDone} hitSlop={8}>
        <Text style={styles.skip}>Skip for now</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700" },
  body: { textAlign: "center", color: "#666", fontSize: 14, lineHeight: 20, maxWidth: 320 },
  connectBtn: { backgroundColor: "#1a73e8", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  disabled: { opacity: 0.5 },
  connectBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  skip: { color: "#999", fontSize: 13, textDecorationLine: "underline" },
  error: { color: "#d33", fontSize: 13 },
});
