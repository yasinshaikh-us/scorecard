import { Moon, Sun } from "lucide-react-native";
import { useTheme } from "../lib/ThemeProvider";
import IconButton from "./IconButton";

// Mirrors src/ThemeToggle.jsx: same circular icon-button shape, same
// sun/moon swap, same "shows the icon for the theme you'd switch to."
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
