import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(
  new URL("./tests/support/server-only.ts", import.meta.url),
);

const alias = {
  "@": srcDir,
  // Neutralize the `server-only` guard under Vitest (no RSC condition active).
  "server-only": serverOnlyStub,
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    globals: false,
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          testTimeout: 5000,
          clearMocks: true,
          restoreMocks: true,
          globals: false,
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 60000,
          hookTimeout: 60000,
          clearMocks: true,
          restoreMocks: true,
          globals: false,
          passWithNoTests: true,
          // Destructive database cleanup must be deterministic: run all
          // integration files sequentially in a single worker so no two suites
          // mutate the shared test database concurrently.
          fileParallelism: false,
          maxWorkers: 1,
          minWorkers: 1,
        },
      },
    ],
  },
});
