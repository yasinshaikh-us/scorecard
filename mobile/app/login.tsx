import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/AuthProvider";

// Mobile equivalent of src/Login.jsx. The web version redirects the whole
// page to Google and back; here signInWithGoogle() (lib/AuthProvider.tsx)
// opens a system browser tab and catches the redirect via a deep link
// instead -- there's no "page" to redirect in a native app.
export default function Login() {
  const { session, signInWithGoogle } = useAuth();
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fathom</Text>
      <Pressable style={styles.button} onPress={handlePress} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue with Google</Text>}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 32 },
  button: {
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 240,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#d33", marginTop: 12, textAlign: "center" },
});
