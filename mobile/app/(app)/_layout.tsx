import { Text } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/AuthProvider";
import { DataProvider } from "../../lib/DataProvider";

// Everything under (app)/ requires a session -- guarded once here rather
// than per-screen -- and shares one DataProvider (one transactions fetch)
// between the Home and Ask tabs, mirroring src/App.jsx's AuthedApp shell.
export default function AppLayout() {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Redirect href="/login" />;

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
