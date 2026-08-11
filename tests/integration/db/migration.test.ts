import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { resetPublicSchema, runMigrateDeploy } from "../support/migrations";
import {
  loadTestDatabaseConfig,
  type TestDatabaseConfig,
} from "../support/test-database-env";
import { createTestPrismaClient } from "../support/test-prisma";

/**
 * Proves the committed `0001_foundation` migration applies cleanly to a
 * genuinely empty database. The suite resets the `public` schema first so the
 * "started empty" assertions are real, not an artifact of a previous run.
 */

const EXPECTED_TABLES = [
  "admin_audit_log",
  "admin_users",
  "brands",
  "business_settings",
  "media_deletion_queue",
] as const;

const EXPECTED_ENUMS = ["admin_role", "listing_state"] as const;

interface NameRow {
  name: string;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/**
 * Application tables in `public`, excluding Prisma's own `_prisma_migrations`
 * bookkeeping table (asserted separately as migration history).
 */
async function listApplicationTables(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<NameRow[]>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> '_prisma_migrations'
     ORDER BY table_name`,
  );
  return rows.map((row) => row.name);
}

async function listEnums(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<NameRow[]>(
    `SELECT t.typname AS name FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'
     ORDER BY t.typname`,
  );
  return rows.map((row) => row.name);
}

async function citextInstalled(client: PrismaClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<NameRow[]>(
    `SELECT extname AS name FROM pg_extension WHERE extname = 'citext'`,
  );
  return rows.length === 1;
}

describe("0001_foundation migration", () => {
  let config: TestDatabaseConfig;
  let client: PrismaClient;

  beforeAll(() => {
    config = loadTestDatabaseConfig();
    client = createTestPrismaClient(config.databaseUrl);
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("deploys from an empty database into exactly the foundation schema", async () => {
    // 1. Establish and prove the empty initial state.
    await resetPublicSchema(client);

    expect(await listApplicationTables(client)).toEqual([]);
    expect(await listEnums(client)).toEqual([]);
    expect(await citextInstalled(client)).toBe(false);

    // 2. Apply committed migrations (deploy — never db push / migrate reset).
    await runMigrateDeploy(config);

    // 3. Migration history records 0001_foundation as successfully applied.
    const migrations = await client.$queryRawUnsafe<MigrationRow[]>(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM "_prisma_migrations" ORDER BY started_at`,
    );
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.migration_name).toBe("0001_foundation");
    expect(migrations[0]?.finished_at).not.toBeNull();
    expect(migrations[0]?.rolled_back_at).toBeNull();

    // 4. Exactly the five foundation tables, and no feature-owned tables.
    expect(await listApplicationTables(client)).toEqual([...EXPECTED_TABLES]);

    // 5. Exactly the two shared enums.
    expect(await listEnums(client)).toEqual([...EXPECTED_ENUMS]);

    // 6. citext is enabled by the migration.
    expect(await citextInstalled(client)).toBe(true);

    // 7. inquiry_notification_emails is NOT NULL (hand-added; invisible to the
    //    Prisma diff because a required String[] renders as a nullable column).
    const columns = await client.$queryRawUnsafe<{ is_nullable: string }[]>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'business_settings'
         AND column_name = 'inquiry_notification_emails'`,
    );
    expect(columns[0]?.is_nullable).toBe("NO");
  });
});
