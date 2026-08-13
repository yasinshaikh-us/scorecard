import { Moon, Sun } from "lucide-react-native";
import { useTheme } from "../lib/ThemeProvider";
import IconButton from "./IconButton";

// Circular icon-button with a sun/moon swap -- shows the icon for the
// theme you'd switch to, not the one you're in.
export default function ThemeToggleButton() {
  const { mode, colors, toggleTheme } = useTheme();
  return (
    <IconButton
      testID="theme-toggle-button"
      onPress={toggleTheme}
      accessibilityLabel={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {mode === "dark" ? <Sun size={17} color={colors.textMuted} /> : <Moon size={17} color={colors.textMuted} />}
    </IconButton>
  );
}
