import { afterAll, beforeAll, beforeEach } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { ensureMigrationsDeployed } from "./migrations";
import {
  loadTestDatabaseConfig,
  type TestDatabaseConfig,
} from "./test-database-env";
import { createTestPrismaClient } from "./test-prisma";
import { truncateAllTables } from "./truncate";

/**
 * Register the standard database lifecycle for a suite:
 *
 *   - `beforeAll`: validate the safety gate, ensure migrations are deployed
 *     (once per process), and open a test-only Prisma client.
 *   - `beforeEach`: truncate the allowlisted tables so each test starts clean
 *     without losing migration history.
 *   - `afterAll`: disconnect the client.
 *
 * The suite is expected to run single-threaded (see the integration Vitest
 * project) so this destructive cleanup is deterministic.
 */
export interface DatabaseSuite {
  /** The test Prisma client. Throws if accessed before `beforeAll` runs. */
  getClient(): PrismaClient;
  /** The validated test-database config. Throws before `beforeAll` runs. */
  getConfig(): TestDatabaseConfig;
}

export interface DatabaseSuiteOptions {
  /** Truncate allowlisted tables before each test. Defaults to `true`. */
  truncateBeforeEach?: boolean;
}

export function setupDatabaseSuite(
  options: DatabaseSuiteOptions = {},
): DatabaseSuite {
  const truncateBetweenTests = options.truncateBeforeEach ?? true;

  let client: PrismaClient | undefined;
  let config: TestDatabaseConfig | undefined;

  beforeAll(async () => {
    config = loadTestDatabaseConfig();
    await ensureMigrationsDeployed(config);
    client = createTestPrismaClient(config.databaseUrl);
  });

  afterAll(async () => {
    if (client !== undefined) {
      await client.$disconnect();
      client = undefined;
    }
  });

  if (truncateBetweenTests) {
    beforeEach(async () => {
      if (client === undefined) {
        throw new Error("Test database client was not initialized.");
      }
      await truncateAllTables(client);
    });
  }

  return {
    getClient() {
      if (client === undefined) {
        throw new Error("Test database client was not initialized.");
      }
      return client;
    },
    getConfig() {
      if (config === undefined) {
        throw new Error("Test database config was not initialized.");
      }
      return config;
    },
  };
}
