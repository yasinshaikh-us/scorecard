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
  },
});
