import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node environment is enough — nothing here renders React components,
    // and the Edge Function tests (supabase/functions/_shared/*.test.ts)
    // need the real Node fetch/crypto, not jsdom's polyfills.
    environment: "node",
    // mobile/ has its own separate Jest-based test runner (mobile/package.json's
    // "test" script) and its own tsconfig (extends "expo/tsconfig.base", which
    // only exists inside mobile/node_modules) -- letting Vitest's default glob
    // pick up mobile/**/*.test.ts(x) breaks the tsconfig resolution here.
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**", "**/tests/synthetic/**", "**/mobile/**"],
    coverage: {
      provider: "v8",
      // Deliberately no `all: true` / broad `include` -- this only
      // instruments the files the suite actually imports (src/logic.js +
      // the portable supabase/functions/_shared/*.ts helpers), matching
      // what `npm test` documents itself as covering in README.md. The
      // Deno-only glue (Deno.serve/Deno.env, `npm:` imports) can't be
      // imported under Node at all, so forcing it into the instrumented
      // set would just fail the run instead of reporting real 0%s.
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 100,
        lines: 100,
      },
    },
  },
});
