import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "api",
      testMatch: /.*\.api\.spec\.ts/,
      use: {},
    },
    {
      name: "chromium",
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
