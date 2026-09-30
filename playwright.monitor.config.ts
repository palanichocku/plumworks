import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./monitoring",
  testMatch: "*.spec.ts",
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["junit", { outputFile: "artifacts/monitoring/playwright/results.xml" }]],
  use: { baseURL: process.env.MONITOR_BASE_URL || "http://127.0.0.1:3000", browserName: "chromium", trace: "off", screenshot: "off", video: "off", actionTimeout: 30_000, navigationTimeout: 45_000 },
  outputDir: "artifacts/monitoring/playwright",
});
