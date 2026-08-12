import { Platform } from "react-native";

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceRecessed: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentStrong: string;
  danger: string;
};

// Same names, same values as ../../src/theme.css's light tokens -- kept
// in sync by hand since React Native can't read a shared CSS file
// directly the way the web app and the web app's design tokens can.
export const lightColors: ThemeColors = {
  bg: "#F7F4EC",
  surface: "#FFFFFF",
  surfaceRecessed: "#EFEBE0",
  border: "#DEDACC",
  borderSubtle: "#E7E3D6",
  text: "#1B1F24",
  textMuted: "#5B6470",
  textFaint: "#8A93A0",
  accent: "#1F7A6C",
  accentStrong: "#175E53",
  danger: "#A23F49",
};

export const darkColors: ThemeColors = {
  bg: "#14181D",
  surface: "#1E242C",
  surfaceRecessed: "#171B21",
  border: "#2A313B",
  borderSubtle: "#20262E",
  text: "#EDE8DE",
  textMuted: "#8B93A0",
  textFaint: "#5A6270",
  accent: "#3FA796",
  accentStrong: "#2C8577",
  danger: "#C1666B",
};

// Same Inter family as --font-body (index.html loads weights 400/500/600/
// 700 from Google Fonts; here they're bundled via @expo-google-fonts/inter
// and loaded with useFonts() in app/_layout.tsx). There's no RN/Expo
// equivalent of --font-mono's exact stack (SF Mono etc. aren't bundleable
// fonts) -- Platform's own built-in monospace face is the native
// equivalent used for the same tabular-numerals money formatting.
export const fontFamily = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
};
