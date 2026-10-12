import { defineConfig, devices } from "@playwright/test";

// Chromium is used for reproducible automated runs. Acceptance in the owner's
// installed Chrome is recorded separately (architecture.md §12).
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
