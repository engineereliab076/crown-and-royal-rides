import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright end-to-end configuration.
 *
 * Locally the dev server is started with `pnpm dev`. In CI the workflow runs
 * `pnpm build` first, so the production server is started with `pnpm start`.
 * The choice is driven entirely by the `CI` environment variable.
 */

const isCI = Boolean(process.env.CI);
const runDatabaseE2E = process.env.RUN_DATABASE_E2E === "true";
const databaseE2ESpec = /purchase-inquiry\.spec\.ts$/;
const explicitlyRequestedDatabaseE2E = process.argv.some((argument) =>
  /(?:^|[\\/])purchase-inquiry\.spec\.ts$/.test(argument),
);

if (explicitlyRequestedDatabaseE2E && !runDatabaseE2E) {
  throw new Error(
    "The Phase 3 database E2E spec requires RUN_DATABASE_E2E=true and the guarded disposable test-database variables.",
  );
}

const baseURL = "http://localhost:3000";

function guardedE2EDatabaseUrl(): string | undefined {
  if (!runDatabaseE2E) return undefined;
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    process.env.ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS !== "true"
  ) {
    throw new Error(
      "Database E2E requires the guarded TEST_DATABASE_URL and explicit destructive-test acknowledgement.",
    );
  }
  const parsed = new URL(value);
  const databaseName = parsed.pathname.slice(1).toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !/(test|scratch)/.test(databaseName) ||
    /(prod|preview|staging)/.test(databaseName) ||
    parsed.hostname.toLowerCase().endsWith(".neon.tech")
  ) {
    throw new Error("Database E2E refused a non-disposable database target.");
  }
  return value;
}

const e2eDatabaseUrl = guardedE2EDatabaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI || runDatabaseE2E ? 1 : undefined,
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
      ...(!runDatabaseE2E ? { testIgnore: databaseE2ESpec } : {}),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pixel-5",
      testIgnore: databaseE2ESpec,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone-13",
      ...(!runDatabaseE2E ? { testIgnore: databaseE2ESpec } : {}),
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: isCI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    // Never hijack an unknown server in CI; locally, reuse a running dev server.
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
    ...(e2eDatabaseUrl === undefined
      ? {}
      : {
          env: {
            DATABASE_URL: e2eDatabaseUrl,
            DIRECT_DATABASE_URL:
              process.env.TEST_DIRECT_DATABASE_URL ?? e2eDatabaseUrl,
            AUTH_SECRET:
              "e2e-auth-secret-only-not-used-outside-local-tests-12345",
            AUTH_URL: baseURL,
            IP_HASH_SECRET:
              "e2e-ip-hash-secret-only-not-used-outside-local-tests-123",
            APP_ORIGIN: baseURL,
            NEXT_PUBLIC_APP_URL: baseURL,
          },
        }),
  },
});
