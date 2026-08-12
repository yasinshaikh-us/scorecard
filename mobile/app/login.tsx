import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Redirect } from "expo-router";
import { useAuth, TEST_LOGIN_ENABLED } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import ThemeToggleButton from "../components/ThemeToggleButton";

// Matches the multicolor "G" mark in src/Login.jsx's inline SVG exactly.
function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <Path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5c-2 1.4-4.7 2.3-7.6 2.3-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.5 39.6 16.2 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C39.9 37 44 31 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </Svg>
  );
}

// Mobile equivalent of src/Login.jsx. The web version redirects the whole
// page to Google and back; here signInWithGoogle() (lib/AuthProvider.tsx)
// opens a system browser tab and catches the redirect via a deep link
// instead -- there's no "page" to redirect in a native app.
export default function Login() {
  const { session, signInWithGoogle, signInWithTestAccount } = useAuth();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/home" />;

  async function handlePress() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in — try again");
    } finally {
      setBusy(false);
    }
  }

  async function handleTestLoginPress() {
    setBusy(true);
    setError(null);
    try {
      await signInWithTestAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.themeToggleWrap}>
        <ThemeToggleButton />
      </View>

      <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.bold }]}>fa/thm</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
        Sign in to continue
      </Text>

      <Pressable
        testID="google-signin-button"
        style={[
          styles.button,
          { backgroundColor: colors.surfaceRecessed, borderColor: colors.border, opacity: busy ? 0.5 : 1 },
        ]}
        onPress={handlePress}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <>
            <GoogleIcon />
            <Text style={[styles.buttonText, { color: colors.text, fontFamily: fontFamily.semibold }]}>
              Continue with Google
            </Text>
          </>
        )}
      </Pressable>

      {/* Only rendered in development/preview builds (see mobile/eas.json)
          -- compiled out of production entirely, not just hidden. Lets a
          test flow (Maestro/Detox, or a human) skip Google's OAuth screen
          by signing in as a designated dummy test account instead. */}
      {TEST_LOGIN_ENABLED ? (
        <Pressable testID="test-signin-button" onPress={handleTestLoginPress} disabled={busy} hitSlop={8}>
          <Text style={[styles.testLoginText, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>
            Sign in as test user
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text>
      ) : null}

      <Text style={[styles.disclaimer, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>
        This gates access to personal transaction data. Once signed in, you can only ever see your own transactions —
        never anyone else's.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  themeToggleWrap: { position: "absolute", top: 20, right: 20 },
  title: { fontSize: 32, letterSpacing: -0.5, marginBottom: -6 },
  subtitle: { fontSize: 13, marginBottom: 8 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minWidth: 240,
    justifyContent: "center",
  },
  buttonText: { fontSize: 14 },
  testLoginText: { fontSize: 13, textDecorationLine: "underline" },
  error: { textAlign: "center", fontSize: 13 },
  disclaimer: { textAlign: "center", fontSize: 12, lineHeight: 18, maxWidth: 280, marginTop: 4 },
});
