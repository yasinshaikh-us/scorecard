import { useCallback, useEffect, useState } from "react";
import { Redirect, Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../../lib/AuthProvider";
import { DataProvider } from "../../lib/DataProvider";
import { supabase } from "../../lib/supabase";
import PlaidLinkGate from "../../components/PlaidLinkGate";

const SKIPPED_LINK_KEY = "skippedLink";

// Everything under (app)/ requires a session -- guarded once here rather
// than per-screen -- and shares one DataProvider (one transactions fetch)
// between the Home and Ask tabs. Also owns the first-login Plaid gate:
// shown once, skippable, only when the user has no plaid_items row yet.
export default function AppLayout() {
  const { session, loading } = useAuth();
  // undefined = checking, null = no linked bank yet, object = at least one row
  const [plaidItem, setPlaidItem] = useState<{ id: string } | null | undefined>(undefined);
  // undefined until AsyncStorage has been read, so a returning user who
  // already skipped never sees the gate flash before it resolves.
  const [skippedLink, setSkippedLink] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(SKIPPED_LINK_KEY).then((v) => setSkippedLink(v === "true"));
  }, []);

  // Skipping used to be in-memory useState, so it lasted exactly as long
  // as the process: cold-launch the app and the gate was back. It read as
  // a dismissal but behaved like a snooze. Persisted, "later" means
  // later. Linking a bank makes the gate's own condition false, so
  // nothing needs to clear this on success.
  const skipLink = useCallback(() => {
    setSkippedLink(true);
    AsyncStorage.setItem(SKIPPED_LINK_KEY, "true");
  }, []);

  useEffect(() => {
    if (!session) {
      setPlaidItem(undefined);
      return;
    }
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .limit(1)
      .then(({ data, error }) => {
        // Fail open: an unreachable/broken link-status check shouldn't
        // block the dashboard.
        if (error) {
          console.error("Failed to check plaid_items", error);
          setPlaidItem(null);
          return;
        }
        setPlaidItem(data?.[0] ?? null);
      });
  }, [session]);

  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  if (plaidItem === undefined || skippedLink === undefined) return null; // still resolving

  if (plaidItem === null && !skippedLink) {
    return <PlaidLinkGate onDone={skipLink} />;
  }

  // A Stack, not Tabs: navigation between the app's two screens now lives
  // in ScreenHeader's second slot. See that component for why the tab bar
  // went. Both screens draw their own header, so this one stays hidden.
  return (
    <DataProvider>
      <Stack screenOptions={{ headerShown: false, animation: "none" }}>
        <Stack.Screen name="home" />
        <Stack.Screen name="ask" />
      </Stack>
    </DataProvider>
  );
}
