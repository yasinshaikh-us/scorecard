import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Filter, Home as HomeIcon, LogOut, MessageCircleQuestion } from "lucide-react-native";
import { useAuth } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import IconButton from "./IconButton";
import ThemeToggleButton from "./ThemeToggleButton";

// The persistent header: brand mark plus the action row, on every screen.
// Each top-level screen renders its own instance rather than sharing one,
// since expo-router has no persistent header slot to hang a single
// instance off.
//
// Slot 2 is the cross-navigation between Home and Ask, and it replaced
// the bottom tab bar entirely -- with only two destinations, a whole
// persistent bar at the bottom of every screen was a lot of permanent
// furniture to move between two places, and it competed with the
// thumb-reachable area the transaction list actually wants. Sign-out sits
// at the far right, furthest from the two navigation controls next to it,
// because it is the one action here you cannot undo by tapping again.
export default function ScreenHeader({ onOpenRules, screen }: { onOpenRules: () => void; screen: "home" | "ask" }) {
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  const goingToAsk = screen === "home";

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.brand, { color: colors.text, fontFamily: fontFamily.semibold }]}>fa/thm</Text>
      <View style={styles.actions}>
        <IconButton testID="rules-button" onPress={onOpenRules} accessibilityLabel="Category rules">
          <Filter size={17} color={colors.textMuted} />
        </IconButton>
        <IconButton
          testID={goingToAsk ? "nav-ask-button" : "nav-home-button"}
          onPress={() => router.replace(goingToAsk ? "/ask" : "/home")}
          accessibilityLabel={goingToAsk ? "Ask about your spending" : "Home"}
        >
          {goingToAsk ? (
            <MessageCircleQuestion size={17} color={colors.textMuted} />
          ) : (
            <HomeIcon size={17} color={colors.textMuted} />
          )}
        </IconButton>
        <ThemeToggleButton />
        <IconButton testID="sign-out-button" onPress={() => signOut()} accessibilityLabel="Sign out">
          <LogOut size={17} color={colors.textMuted} />
        </IconButton>
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
