import { defineConfig, devices } from "@playwright/test";

// Synthetic / black-box monitoring suite — distinct from playwright.config.js
// (tests/e2e), which runs mocked, credential-free checks against a local
// build as a pre-merge CI gate. This suite instead targets a real, already
// running deployment (baseURL below), so it's never wired into ci.yml and
// is meant to run on a schedule (see .github/workflows/synthetic-monitor.yml)
// or on demand.
//
// Only layer 1 (tests/synthetic/canary.spec.js — unauthenticated checks) is
// implemented today, so this config provisions nothing beyond a base URL.
// Layers 2/3 will need real Supabase/Google credentials once their
// provisioning procedure is decided; this file will grow accordingly.

if (!process.env.SYNTHETIC_BASE_URL) {
  throw new Error(
    "SYNTHETIC_BASE_URL must be set to the deployed app's URL to run the synthetic suite " +
      "(e.g. https://your-deployment.vercel.app)."
  );
}

export default defineConfig({
  testDir: "./tests/synthetic",
  timeout: 30_000,
  fullyParallel: true,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SYNTHETIC_BASE_URL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer here, deliberately — this suite talks to a real deployment,
  // not a local build.
});
