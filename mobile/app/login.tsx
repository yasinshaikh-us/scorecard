import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Redirect } from "expo-router";
import Constants from "expo-constants";
import { FlaskConical } from "lucide-react-native";
import { useAuth, TEST_LOGIN_ENABLED } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import IconButton from "../components/IconButton";
import ThemeToggleButton from "../components/ThemeToggleButton";

// Read from app.json rather than hardcoded, so the number on screen can
// never drift from the one the build was cut with.
const VERSION = Constants.expoConfig?.version ?? "";

// Google's official multicolor "G" mark, as inline SVG paths. Google
// publishes an icon-only sign-in button alongside the labelled one, so
// dropping the wordmark stays inside their branding rules -- but the mark
// itself may not be recoloured or redrawn, which is why this is the
// unmodified original in both themes.
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
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

// The unauthenticated entry point. signInWithGoogle()
// (lib/AuthProvider.tsx) opens a system browser tab and catches the
// redirect via a deep link -- there's no "page" to redirect away and back
// in a native app, the way a browser-based sign-in would.
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

      {/* assets/icon.png itself, not a redraw -- the same file the
          launcher icon is built from. It was already in the repo and
          unused on any screen. */}
      <Image source={require("../assets/icon.png")} style={styles.mark} accessibilityIgnoresInvertColors />
      <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.bold }]}>fa/thm</Text>
      <Text style={[styles.tagline, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
        Navigate your expenses.
      </Text>

      <IconButton
        testID="google-signin-button"
        onPress={handlePress}
        disabled={busy}
        size={56}
        style={{ backgroundColor: colors.surfaceRecessed }}
        accessibilityLabel="Continue with Google"
      >
        {busy ? <ActivityIndicator color={colors.text} /> : <GoogleIcon size={26} />}
      </IconButton>

      {/* Only rendered in development/preview builds (see mobile/eas.json)
          -- compiled out of production entirely, not just hidden. Lets a
          test flow (Maestro/Detox, or a human) skip Google's OAuth screen
          by signing in as a designated dummy test account instead. */}
      {TEST_LOGIN_ENABLED ? (
        <IconButton
          testID="test-signin-button"
          onPress={handleTestLoginPress}
          disabled={busy}
          size={40}
          style={styles.testLogin}
          accessibilityLabel="Sign in as test user"
        >
          <FlaskConical size={18} color={colors.textFaint} />
        </IconButton>
      ) : null}

      {/* Fixed height so a failed sign-in doesn't shift the button the
          user is about to press again. */}
      <View style={styles.errorSlot}>
        {error ? (
          <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text>
        ) : null}
      </View>

      {/* Anchored to the bottom rather than added to the centred stack,
          so it never shifts when the stack grows -- and stays out of the
          way. */}
      <Text testID="app-version" style={[styles.version, { color: colors.textFaint, fontFamily: fontFamily.mono }]}>
        v{VERSION}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  themeToggleWrap: { position: "absolute", top: 20, right: 20 },
  mark: { width: 64, height: 64, borderRadius: 15 },
  title: { fontSize: 32, letterSpacing: -0.5, marginBottom: -6 },
  tagline: { fontSize: 14.5, marginBottom: 8 },
  testLogin: { borderWidth: 0 },
  errorSlot: { minHeight: 19, alignItems: "center", justifyContent: "center" },
  error: { textAlign: "center", fontSize: 13 },
  version: { position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center", fontSize: 10, letterSpacing: 0.4 },
});
