import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4310", viewport: { width: 1000, height: 760 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "bun tests/e2e/support/serve.ts",
    url: "http://localhost:4310/api/config",
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
