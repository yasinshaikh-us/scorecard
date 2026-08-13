import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkColors, lightColors, type ThemeColors, type ThemeMode } from "./theme";

type Mode = ThemeMode;
type ThemeContextValue = {
  mode: Mode;
  colors: ThemeColors;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "theme";

// Mirrors src/theme.css + src/ThemeToggle.jsx's mechanism: follows the
// OS color scheme (useColorScheme(), the native equivalent of
// prefers-color-scheme) until the user explicitly picks one via
// toggleTheme(), at which point that override is persisted (AsyncStorage
// here, localStorage on web) and wins from then on -- same "system
// unless overridden" behavior on both clients.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<Mode | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark") setOverride(stored);
    });
  }, []);

  const mode: Mode = override ?? (systemScheme === "light" ? "light" : "dark");

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors: mode === "dark" ? darkColors : lightColors,
      toggleTheme: () => {
        const next: Mode = mode === "dark" ? "light" : "dark";
        setOverride(next);
        AsyncStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be called within a ThemeProvider");
  return ctx;
}
