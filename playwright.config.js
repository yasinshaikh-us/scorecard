import { defineConfig, devices } from "@playwright/test";

// One thin end-to-end smoke test (tier 3 of the test suite) — everything
// else is Vitest unit tests. Runs against a built+previewed copy of the app
// with the transactions/query Edge Functions mocked at the network layer,
// so it needs no real Anthropic/Supabase credentials.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    // Set only for local runs against a pre-installed browser (e.g. this
    // sandbox); CI installs its own via `playwright install` and leaves
    // this unset.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Needed at build time so the client bundle has values to read
      // (see src/supabaseClient.js). auth.getSession() only ever reads
      // the locally-seeded session from localStorage in this suite (see
      // tests/e2e/dashboard.spec.js), so these never need to be real.
      VITE_SUPABASE_URL: "https://e2e-test-project.supabase.co",
      VITE_SUPABASE_ANON_KEY: "e2e-test-anon-key-not-real",
    },
  },
});
