import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../lib/ThemeProvider";

// What the button does, not where it sits. Since no button in the app
// carries a word any more, fill is the only thing left to carry meaning,
// so it maps to the action rather than to the screen:
//   ghost  -- dismiss or step back (outlined, muted glyph)
//   accent -- the affirmative action
//   danger -- the destructive one
export type IconButtonVariant = "ghost" | "accent" | "danger";

// The visible circle can be as small as 28px in a dense row, which is
// under the 44pt minimum touch target on both platforms. Rather than
// inflate the artwork, every instance gets hitSlop making up the
// difference, so the tappable area clears 44 even where the drawn circle
// does not.
function slopFor(size: number) {
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  return { top: slop, bottom: slop, left: slop, right: slop };
}

// Circular icon button -- one shared shape for every button in the app
// (nav row, add/disconnect/delete/edit actions, theme toggle, and both
// halves of every confirm), instead of a different one-off style per
// screen.
export default function IconButton({
  children,
  active,
  size = 34,
  variant = "ghost",
  style,
  hitSlop,
  ...rest
}: Omit<PressableProps, "style"> & {
  children: React.ReactNode;
  active?: boolean;
  size?: number;
  variant?: IconButtonVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const fill =
    variant === "accent" ? colors.accent : variant === "danger" ? colors.danger : active ? colors.surfaceRecessed : "transparent";

  return (
    <Pressable
      {...rest}
      hitSlop={hitSlop ?? slopFor(size)}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: colors.border,
          backgroundColor: fill,
          alignItems: "center",
          justifyContent: "center",
        },
        rest.disabled ? { opacity: 0.5 } : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
