import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test-e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  // The dev server gets flaky under concurrent Cesium-initializing workers;
  // serialize to keep these smoke tests deterministic. Add fullyParallel: true
  // back if/when we move to a heavier CI runner.
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
