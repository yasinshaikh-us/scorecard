import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

const CYCLE_MS = 24000;

// Horizontal placement and size cycle rather than being random: the
// column has to look scattered, but it also has to look the same on every
// launch and in every screenshot Stage 2 takes. Math.random() here would
// make that visual verification meaningless.
const ALIGN = ["left", "center", "right", "center", "left", "right", "center", "left"] as const;
const SIZE = ["m", "s", "l", "m", "s", "l", "m", "s"] as const;

const FONT_SIZE = { s: 12.5, m: 14, l: 15.5 };

// Idle-state suggestions, drifting upward as bare text.
//
// Bare text, not chips: a bordered pill turns each line into an object
// you have to parse before you can read it, and eight of them stacked
// read as a form. Unbounded text just reads.
export default function RisingSuggestions({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: string[];
  disabled?: boolean;
  onPick: (s: string) => void;
}) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  // Someone who has asked the OS to stop moving things gets the same
  // suggestions as a plain static column. The drifting version relies on
  // absolute positioning to overlap items in the same space, so this is a
  // different layout rather than the same one with the motion switched
  // off -- held still, eight absolutely-positioned items would render on
  // top of each other.
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <View testID="ask-suggestions" style={styles.staticWrap}>
        {suggestions.map((s) => (
          <Pressable key={s} testID="ask-suggestion" disabled={disabled} onPress={() => onPick(s)} style={styles.staticHit}>
            <Text style={[styles.text, { fontSize: FONT_SIZE.m, color: colors.textFaint, fontFamily: fontFamily.regular }]}>
              {s}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View testID="ask-suggestions" style={styles.wrap}>
      {suggestions.map((s, i) => (
        <RisingItem
          key={s}
          text={s}
          index={i}
          count={suggestions.length}
          // Travel has to exceed the visible column or an item would pop
          // out of existence mid-screen; the window height is a safe
          // upper bound for a container always shorter than the screen.
          travel={height}
          color={colors.textFaint}
          disabled={disabled}
          onPick={onPick}
        />
      ))}
    </View>
  );
}

// Two nested elements per item on purpose -- the outer Animated.View owns
// the vertical drift, the inner Pressable owns the hit area -- so
// placement and motion never fight over a single transform.
function RisingItem({
  text,
  index,
  count,
  travel,
  color,
  disabled,
  onPick,
}: {
  text: string;
  index: number;
  count: number;
  travel: number;
  color: string;
  disabled?: boolean;
  onPick: (s: string) => void;
}) {
  const progress = useSharedValue(0);

  // Every item runs the identical 0->1 loop; the stagger is a constant
  // phase offset applied when the value is read, so the items are evenly
  // distributed up the column at any moment rather than arriving in a
  // clump. Keeping it out of the animation means each item's timeline
  // starts clean instead of needing a shortened first pass.
  const phase = index / count;

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = (progress.value + phase) % 1;
    // Fade in over the first 12% and out over the last 18%, so nothing
    // appears or vanishes at full strength.
    const opacity = p < 0.12 ? p / 0.12 : p > 0.82 ? Math.max(0, (1 - p) / 0.18) : 1;
    return { opacity, transform: [{ translateY: travel - p * (travel + 40) }] };
  });

  return (
    <Animated.View
      style={[styles.slot, styles[ALIGN[index % ALIGN.length]], animatedStyle]}
      pointerEvents="box-none"
    >
      {/* Padding is the hit area: the visible text is small and moving,
          so each line carries an invisible band around it to tap. */}
      <Pressable testID="ask-suggestion" disabled={disabled} onPress={() => onPick(text)} style={styles.hit}>
        <Text
          style={[
            styles.text,
            { fontSize: FONT_SIZE[SIZE[index % SIZE.length]], color, fontFamily: fontFamily.regular },
          ]}
        >
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 360, overflow: "hidden" },
  staticWrap: { paddingHorizontal: 16, paddingTop: 8 },
  staticHit: { paddingVertical: 8 },
  slot: { position: "absolute", left: 20, right: 20, top: 0 },
  left: { alignItems: "flex-start" },
  center: { alignItems: "center" },
  right: { alignItems: "flex-end" },
  hit: { paddingVertical: 10, paddingHorizontal: 12, maxWidth: "80%" },
  text: { fontStyle: "italic", lineHeight: 20 },
});
