import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { functionUrl } from "./functionsClient";

WebBrowser.maybeCompleteAuthSession();

// Only set in development/preview EAS profiles (see mobile/eas.json) --
// undefined here means the code below is dead in a production build, and
// Metro strips it accordingly. See the test-login Edge Function for what
// this unlocks and why: bootstrapping a session for a designated dummy
// test account without driving Google's OAuth screen, the same reason
// the web app's own e2e/synthetic tests inject a session directly rather
// than automating Google sign-in.
export const TEST_LOGIN_ENABLED = process.env.EXPO_PUBLIC_ENABLE_TEST_LOGIN === "true";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithTestAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Google OAuth via Supabase, adapted for a native app: the web app
// (src/Login.jsx) can just redirect the whole page to Google and back, but
// there's no "page" here -- this opens Google's consent screen in a system
// browser tab (WebBrowser.openAuthSessionAsync), then captures the redirect
// back into the app via a deep link (the "fathom://" scheme from app.json).
// PKCE flow (see lib/supabase.ts) means that redirect carries a `code`
// query param, not tokens directly, which exchangeCodeForSession() turns
// into a real session -- supabase-js then persists it via LargeSecureStore
// and the onAuthStateChange listener below picks it up.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      async signInWithGoogle() {
        const redirectTo = AuthSession.makeRedirectUri({ scheme: "fathom" });

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw error;
        if (!data.url) throw new Error("Supabase didn't return an OAuth URL");

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== "success") return; // user cancelled -- not an error

        const code = new URL(result.url).searchParams.get("code");
        if (!code) throw new Error("No authorization code in the OAuth redirect");

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      },
      async signInWithTestAccount() {
        const secret = process.env.EXPO_PUBLIC_TEST_LOGIN_SECRET;
        if (!TEST_LOGIN_ENABLED || !secret) throw new Error("Test login isn't enabled in this build.");

        const resp = await fetch(functionUrl("test-login"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret }),
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body?.error || "Test login failed");

        const { error } = await supabase.auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        });
        if (error) throw error;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be called within an AuthProvider");
  return ctx;
}
