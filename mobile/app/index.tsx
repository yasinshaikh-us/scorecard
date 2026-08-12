import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";

// Entry route: waits for the session-restore check (getSession() reading
// the encrypted LargeSecureStore, see lib/supabase.ts) before deciding
// where to send the user, so a signed-in user never flashes the login
// screen on cold start.
export default function Index() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={session ? "/home" : "/login"} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
