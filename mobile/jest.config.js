const jestExpoPreset = require("jest-expo/jest-preset");

// jest-expo's own preset only transforms .js/.jsx/.ts/.tsx (its
// transform["\\.[jt]sx?$"] entry). lucide-react-native's package.json
// "exports" map resolves to an untranspiled ESM (.mjs) build under this
// project's react-native/Metro module-resolution conditions -- Metro
// itself handles ESM fine, but Jest's CJS-based runtime doesn't, so
// importing it (mobile/lib/categoryIcons.ts) throws "SyntaxError:
// Unexpected token 'export'" without this. Reusing the exact same
// babel transformer + options jest-expo already computed for .jsx?
// files (rather than hand-rolling a second babel config that could
// silently drift from it) is what actually gets .mjs processed instead
// of babel's default "don't touch node_modules" no-op.
const jsxTransform = jestExpoPreset.transform["\\.[jt]sx?$"];

module.exports = {
  ...jestExpoPreset,
  transform: {
    "\\.mjs$": jsxTransform,
    ...jestExpoPreset.transform,
  },
  // ThemeProvider (lib/ThemeProvider.tsx) reads AsyncStorage on mount, and
  // now wraps most screens/components, so most tests render it whether or
  // not the test itself cares about theming. The package's own official
  // in-memory mock, applied globally here, means those tests don't each
  // need their own jest.mock("@react-native-async-storage/async-storage",
  // ...) boilerplate just to avoid AsyncStorage's real native module
  // throwing in a Jest environment. lib/supabase.test.ts still calls
  // jest.mock() on this itself (deliberately, with controllable return
  // values, to exercise LargeSecureStore's real encrypt/decrypt path) --
  // an explicit jest.mock() in a test file overrides this default for
  // that file, so the two don't conflict.
  moduleNameMapper: {
    ...jestExpoPreset.moduleNameMapper,
    "^@react-native-async-storage/async-storage$": "@react-native-async-storage/async-storage/jest",
  },
  // Shipped by react-native-worklets for exactly this: Reanimated 4's
  // entrypoint pulls in worklets' `.native.ts` implementation, which
  // calls into a JSI module that doesn't exist in a Jest process
  // ("Cannot read properties of undefined (reading 'loadUnpackers')").
  // The resolver drops the `.native` extension for anything under
  // react-native-worklets so the plain-JS implementation resolves
  // instead. Preferred over blanket-mocking react-native-reanimated,
  // which would replace Animated.View and leave RisingSuggestions'
  // real rendering untested.
  resolver: "react-native-worklets/jest/resolver",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-gifted-charts|gifted-charts-core|lucide-react-native|react-native-reanimated|react-native-worklets|standard-navigation))",
  ],
  testTimeout: 20000,
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/e2e/"],
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "!**/*.test.{ts,tsx}",
    "!app/_layout.tsx",
    "!lib/types.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 93,
      branches: 85,
      functions: 88,
      lines: 95,
    },
  },
};
