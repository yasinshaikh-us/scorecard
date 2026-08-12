import { Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBankLink } from "../lib/useBankLink";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

// Shown once, between sign-in and the dashboard, the first time a user
// has no linked bank -- mirrors src/PlaidLinkGate.jsx. Skippable, never
// blocks access. Banks can also be added later via the "+ Add bank"
// button on Home, which shares this same useBankLink hook.
export default function PlaidLinkGate({ onDone }: { onDone: () => void }) {
  const { startLink, connecting, error } = useBankLink(onDone);
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.bold }]}>Connect your bank</Text>
      <Text style={[styles.body, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
        Link a bank account so new transactions and balances sync in automatically. You can always add this later.
      </Text>

      <Pressable
        testID="plaid-gate-connect-button"
        style={[styles.connectBtn, { backgroundColor: colors.accent }, connecting && styles.disabled]}
        onPress={startLink}
        disabled={connecting}
      >
        <Text style={[styles.connectBtnText, { color: colors.bg, fontFamily: fontFamily.semibold }]}>
          {connecting ? "Connecting…" : "Connect a bank account"}
        </Text>
      </Pressable>

      <Pressable testID="plaid-gate-skip-button" onPress={onDone} hitSlop={8}>
        <Text style={[styles.skip, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>Skip for now</Text>
      </Pressable>

      {error ? <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 22 },
  body: { textAlign: "center", fontSize: 14, lineHeight: 20, maxWidth: 320 },
  connectBtn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  disabled: { opacity: 0.5 },
  connectBtnText: { fontSize: 14 },
  skip: { fontSize: 13, textDecorationLine: "underline" },
  error: { fontSize: 13 },
});
