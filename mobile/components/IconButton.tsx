import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../lib/ThemeProvider";

// Circular bordered icon button -- the RN equivalent of src/styles.js's
// navIconBtn/themeToggle shape, reused everywhere the web app uses that
// same circular icon-button language (nav row, disconnect/delete/edit
// actions, theme toggle) instead of a different one-off style per screen.
export default function IconButton({
  children,
  active,
  size = 34,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  children: React.ReactNode;
  active?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      {...rest}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: active ? colors.surfaceRecessed : "transparent",
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
