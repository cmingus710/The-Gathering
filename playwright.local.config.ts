import { defineConfig, devices } from "@playwright/test";

/**
 * Signed-in walkthrough against a LOCAL Supabase stack (never a hosted
 * project). See docs/phase-11-release-readiness.md#local-signed-in-walkthrough
 * for setup: `supabase start` on the repo migrations and seed, then a build
 * pointed at http://127.0.0.1:54321 served on port 3100.
 */
export default defineConfig({
  testDir: "tests/e2e-local",
  outputDir: "test-results/local",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
