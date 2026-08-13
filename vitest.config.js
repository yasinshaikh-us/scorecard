import { defineConfig } from "vitest/config";

// The repo root holds no application code -- the app itself is the Expo
// app in mobile/, which has its own Jest-based runner (mobile/package.json's
// "test" script). This config exists for one thing: the portable, Node-
// runnable logic inside the Supabase Edge Functions
// (supabase/functions/_shared/*.test.ts), which is backend code the mobile
// app calls and which nothing in mobile/ covers.
//
// (Previously this was vite.config.js, doing double duty as the web app's
// build config -- there's no web app any more, so only the test half of it
// survives, without the vite/React plugin machinery.)
export default defineConfig({
  test: {
    // Node environment, not jsdom: nothing here renders a UI, and the Edge
    // Function tests need the real Node fetch/crypto rather than jsdom's
    // polyfills.
    environment: "node",
    // mobile/ has its own separate Jest-based test runner and its own
    // tsconfig (extends "expo/tsconfig.base", which only exists inside
    // mobile/node_modules) -- letting Vitest's default glob pick up
    // mobile/**/*.test.ts(x) breaks the tsconfig resolution here.
    exclude: ["**/node_modules/**", "**/mobile/**"],
    coverage: {
      provider: "v8",
      // Deliberately no `all: true` / broad `include` -- this only
      // instruments the files the suite actually imports (the portable
      // supabase/functions/_shared/*.ts helpers). The Deno-only glue
      // (Deno.serve/Deno.env, `npm:` imports) can't be imported under Node
      // at all, so forcing it into the instrumented set would just fail the
      // run instead of reporting real 0%s.
      reporter: ["text", "text-summary"],
      // Re-baselined when the web app was removed. The old numbers
      // (95/90/100/100) were an aggregate over src/logic.js *plus* these
      // helpers; src/logic.js was the better-covered half, so dropping it
      // moved the aggregate down to what supabase/functions/_shared/ alone
      // actually achieves (98.27/82.35/100/100 at the time of the removal)
      // without a single test being deleted. These are set just under that
      // measured baseline, so the same rule still holds: a regression that
      // drops coverage below what's checked in fails the run.
      thresholds: {
        statements: 98,
        branches: 82,
        functions: 100,
        lines: 100,
      },
    },
  },
});
