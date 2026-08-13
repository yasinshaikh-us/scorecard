import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Home as HomeIcon, MessageCircleQuestion } from "lucide-react-native";
import { useAuth } from "../../lib/AuthProvider";
import { useTheme } from "../../lib/ThemeProvider";
import { fontFamily } from "../../lib/theme";
import { DataProvider } from "../../lib/DataProvider";
import { supabase } from "../../lib/supabase";
import PlaidLinkGate from "../../components/PlaidLinkGate";

// Everything under (app)/ requires a session -- guarded once here rather
// than per-screen -- and shares one DataProvider (one transactions fetch)
// between the Home and Ask tabs. Also owns the first-login Plaid gate:
// shown once, skippable, only when the user has no plaid_items row yet.
export default function AppLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();
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
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11 },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => <HomeIcon size={20} color={color} />,
            // Default tab labels ("Home") collide with visible in-screen text
            // elsewhere (e.g. Ask's own "Ask" button) -- a stable testID on
            // the tab button itself, via this standard react-navigation
            // customization point, is what e2e/appFlows.test.js switches
            // tabs with instead of matching by text.
            tabBarButton: ({ ref: _ref, ...props }) => <Pressable {...props} testID="tab-home-button" />,
          }}
        />
        <Tabs.Screen
          name="ask"
          options={{
            title: "Ask",
            tabBarIcon: ({ color }) => <MessageCircleQuestion size={20} color={color} />,
            tabBarButton: ({ ref: _ref, ...props }) => <Pressable {...props} testID="tab-ask-button" />,
          }}
        />
      </Tabs>
    </DataProvider>
  );
}
