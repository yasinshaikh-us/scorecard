// Jest stand-in for react-native-reanimated. As of Reanimated 4.7 /
// Worklets 0.13 neither the real module nor its shipped `mock` can be
// imported in a plain Jest process (the entrypoint calls JSI-only worklets
// APIs at import time). Animated.View is React Native's own View, so the
// component still renders its real tree; only animation drivers are inert.
const React = require("react");
const { View } = require("react-native");

const AnimatedView = React.forwardRef((props, ref) => React.createElement(View, { ...props, ref }));
AnimatedView.displayName = "Animated.View";

const useSharedValue = (init) => React.useRef({ value: init }).current;

module.exports = {
  __esModule: true,
  default: { View: AnimatedView, createAnimatedComponent: (c) => c },
  Easing: { linear: (t) => t },
  cancelAnimation: () => {},
  useAnimatedStyle: (fn) => fn(),
  useReducedMotion: () => false,
  useSharedValue,
  withRepeat: (v) => v,
  withTiming: (v) => v,
};
