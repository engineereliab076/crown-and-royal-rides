import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright end-to-end configuration.
 *
 * Locally the dev server is started with `pnpm dev`. In CI the workflow runs
 * `pnpm build` first, so the production server is started with `pnpm start`.
 * The choice is driven entirely by the `CI` environment variable.
 */

const isCI = Boolean(process.env.CI);

const baseURL = "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  // HTML report only; never auto-open it (blocks CI and headless runs).
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pixel-5",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone-13",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: isCI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    // Never hijack an unknown server in CI; locally, reuse a running dev server.
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
  },
});
