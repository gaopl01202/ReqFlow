import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  use: {
    actionTimeout: 10000,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { timeout: 30000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: "../.local/playwright-results",
});
