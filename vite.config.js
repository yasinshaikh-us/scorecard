import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node environment is enough — nothing here renders React components,
    // and the Edge Function tests (supabase/functions/_shared/*.test.ts)
    // need the real Node fetch/crypto, not jsdom's polyfills.
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**", "**/tests/synthetic/**"],
  },
});
