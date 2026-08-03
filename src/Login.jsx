import { useState } from "react";
import { getSupabaseClient } from "./supabaseClient.js";
import ThemeToggle from "./ThemeToggle.jsx";
import { styles } from "./styles.js";

export default function Login() {
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signInWithGoogle() {
    setIsSubmitting(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError("Couldn't start sign-in — try again");
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ ...styles.page, alignItems: "center", justifyContent: "center", minHeight: "100vh", textAlign: "center" }}>
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <ThemeToggle />
      </div>

      <div style={styles.brand}>Fathom</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: -8 }}>
        Sign in to continue
      </div>

      <button
        onClick={signInWithGoogle}
        disabled={isSubmitting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--surface-recessed)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 20px",
          color: "var(--text)",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 600,
          cursor: isSubmitting ? "default" : "pointer",
          opacity: isSubmitting ? 0.5 : 1,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5c-2 1.4-4.7 2.3-7.6 2.3-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C39.9 37 44 31 44 24c0-1.3-.1-2.7-.4-3.5z" />
        </svg>
        Continue with Google
      </button>

      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}

      <div style={{ color: "var(--text-faint)", fontSize: 12, maxWidth: 280, lineHeight: 1.6 }}>
        This gates access to personal transaction data. Once signed in, you can
        only ever see your own transactions — never anyone else's.
      </div>
    </div>
  );
}
