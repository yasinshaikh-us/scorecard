import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/AuthProvider";
import { DataProvider } from "../../lib/DataProvider";
import { supabase } from "../../lib/supabase";
import PlaidLinkGate from "../../components/PlaidLinkGate";

// Everything under (app)/ requires a session -- guarded once here rather
// than per-screen -- and shares one DataProvider (one transactions fetch)
// between the Home and Ask tabs, mirroring src/App.jsx's AuthedApp shell.
// Also mirrors src/App.jsx's first-login Plaid gate: shown once, skippable,
// only when the user has no plaid_items row yet.
export default function AppLayout() {
  const { session, loading } = useAuth();
  // undefined = checking, null = no linked bank yet, object = at least one row
  const [plaidItem, setPlaidItem] = useState<{ id: string } | null | undefined>(undefined);
  const [skippedLink, setSkippedLink] = useState(false);

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
  if (plaidItem === undefined) return null; // checking for a linked bank

  if (plaidItem === null && !skippedLink) {
    return <PlaidLinkGate onDone={() => setSkippedLink(true)} />;
  }

  return (
    <DataProvider>
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="home"
          options={{ title: "Home", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text> }}
        />
        <Tabs.Screen
          name="ask"
          options={{ title: "Ask", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💬</Text> }}
        />
      </Tabs>
    </DataProvider>
  );
}
