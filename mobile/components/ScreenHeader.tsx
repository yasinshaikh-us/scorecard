import { StyleSheet, Text, View } from "react-native";
import { Filter, LogOut } from "lucide-react-native";
import { useAuth } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import IconButton from "./IconButton";
import ThemeToggleButton from "./ThemeToggleButton";

// Mirrors src/App.jsx's persistent header: the brand mark plus the same
// Rules/Sign-out/theme-toggle icon row on every screen (there, Home and
// Ask share one header instance; here each top-level tab screen renders
// its own, since expo-router's Tabs don't share a persistent header slot
// the way the web shell's AuthedApp does).
export default function ScreenHeader({ onOpenRules }: { onOpenRules: () => void }) {
  const { signOut } = useAuth();
  const { colors } = useTheme();

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.brand, { color: colors.text, fontFamily: fontFamily.semibold }]}>fa/thm</Text>
      <View style={styles.actions}>
        <IconButton testID="rules-button" onPress={onOpenRules} accessibilityLabel="Rules">
          <Filter size={17} color={colors.textMuted} />
        </IconButton>
        <IconButton testID="sign-out-button" onPress={() => signOut()} accessibilityLabel="Sign out">
          <LogOut size={17} color={colors.textMuted} />
        </IconButton>
        <ThemeToggleButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { fontSize: 22, letterSpacing: -0.3 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
});
