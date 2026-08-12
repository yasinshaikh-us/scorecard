const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-router's file-based routing scans every file under app/ as a
// potential route (see node_modules/expo-router/_ctx.js's require.context
// -- it only excludes +api/+html files, nothing else), so a co-located
// *.test.tsx next to a screen/layout gets swept in as a route module and
// pulled into the bundle, where @testing-library/react-native's Node-only
// imports (console, util) break `expo export`/`expo start`. The default
// Expo Metro config already blocks a `__tests__/` folder (see its own
// blockList below) but not colocated `*.test.ts(x)` files, which is this
// project's actual convention (matching every other test in the repo, in
// components/ and lib/ -- those directories just aren't route-scanned).
// Test files should never ship in a bundle anyway, so block them from
// Metro's resolver outright rather than relocating tests out of app/.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]),
  /\.test\.[jt]sx?$/,
];

module.exports = config;
