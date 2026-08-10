import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

const alias = {
  "@": srcDir,
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
          testTimeout: 30000,
          clearMocks: true,
          restoreMocks: true,
          globals: false,
          passWithNoTests: true,
        },
      },
    ],
  },
});
