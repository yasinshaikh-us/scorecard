import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronsRight, Link2, RotateCw } from "lucide-react-native";
import { useBankLink } from "../lib/useBankLink";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import IconButton from "./IconButton";
import ThemeToggleButton from "./ThemeToggleButton";

// Shown once, between sign-in and the dashboard, the first time a user
// has no linked bank. Skippable, never blocks access. Banks can also be
// added later via the add button on Home, which shares this same
// useBankLink hook.
export default function PlaidLinkGate({ onDone }: { onDone: () => void }) {
  const { startLink, connecting, error } = useBankLink(onDone);
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Matches login's placement exactly. This was the only screen in
          the app without a toggle, which meant a user who landed here in
          a theme they disliked had to get past it first. */}
      <View style={styles.toggleWrap}>
        <ThemeToggleButton />
      </View>

      <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.bold }]}>Connect your bank</Text>
      <Text style={[styles.body, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
        Link a bank account so new transactions and balances sync in automatically. You can always add this later.
      </Text>

      {/* One circle in one place across all three states: the link glyph
          becomes a spinner while connecting and a retry glyph on failure,
          so recovery is the same control the user just pressed rather
          than something to infer from the message underneath it. */}
      <IconButton
        testID="plaid-gate-connect-button"
        onPress={startLink}
        disabled={connecting}
        size={56}
        variant="accent"
        style={styles.connectBtn}
        accessibilityLabel={
          connecting ? "Connecting to your bank" : error ? "Try connecting again" : "Connect a bank account"
        }
      >
        {connecting ? (
          <ActivityIndicator color={colors.bg} />
        ) : error ? (
          <RotateCw size={22} color={colors.bg} strokeWidth={2.2} />
        ) : (
          <Link2 size={22} color={colors.bg} strokeWidth={2.2} />
        )}
      </IconButton>

      <IconButton
        testID="plaid-gate-skip-button"
        onPress={onDone}
        size={40}
        style={styles.skip}
        // The label carries what the glyph cannot: a double-chevron says
        // "move past this" but not "you can add a bank later", and that
        // reassurance is the whole reason this escape exists.
        accessibilityLabel="Skip for now — you can add a bank later"
      >
        <ChevronsRight size={18} color={colors.textFaint} />
      </IconButton>

      {/* Fixed height, always present. The stack is vertically centred,
          so an error appearing from nowhere would shift every element
          above it -- moving the button out from under the thumb about to
          retry. */}
      <View style={styles.errorSlot}>
        {error ? <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  toggleWrap: { position: "absolute", top: 20, right: 20 },
  title: { fontSize: 22 },
  body: { textAlign: "center", fontSize: 14, lineHeight: 20, maxWidth: 320 },
  connectBtn: { marginTop: 8 },
  skip: { borderWidth: 0 },
  errorSlot: { minHeight: 19, alignItems: "center", justifyContent: "center", maxWidth: 300 },
  error: { fontSize: 13, textAlign: "center" },
});
