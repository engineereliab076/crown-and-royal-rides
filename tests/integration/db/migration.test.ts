import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { resetPublicSchema, runMigrateDeploy } from "../support/migrations";
import {
  loadTestDatabaseConfig,
  type TestDatabaseConfig,
} from "../support/test-database-env";
import { createTestPrismaClient } from "../support/test-prisma";

/**
 * Proves the committed migrations 0001–0004 apply cleanly, in order, to a
 * genuinely empty database. The suite resets the `public` schema first so the
 * "started empty" assertions are real, not an artifact of a previous run.
 */

const EXPECTED_TABLES = [
  "admin_audit_log",
  "admin_users",
  "brands",
  "business_settings",
  "inquiries",
  "media_deletion_queue",
  "vehicle_images",
  "vehicles",
] as const;

const EXPECTED_ENUMS = [
  "admin_role",
  "body_type",
  "driver_option",
  "fuel_type",
  "inquiry_status",
  "inquiry_type",
  "listing_state",
  "sale_status",
  "transmission",
  "vehicle_condition",
] as const;

const EXPECTED_MIGRATIONS = [
  "0001_foundation",
  "0002_vehicles",
  "0003_vehicle_images",
  "0004_inquiries",
] as const;

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

async function extensionInstalled(
  client: PrismaClient,
  name: string,
): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<NameRow[]>(
    `SELECT extname AS name FROM pg_extension WHERE extname = $1`,
    name,
  );
  return rows.length === 1;
}

describe("0001–0004 migrations", () => {
  let config: TestDatabaseConfig;
  let client: PrismaClient;

  beforeAll(() => {
    config = loadTestDatabaseConfig();
    client = createTestPrismaClient(config.databaseUrl);
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("deploys from an empty database into exactly the Phase 1 + Phase 3 schema", async () => {
    // 1. Establish and prove the empty initial state.
    await resetPublicSchema(client);

    expect(await listApplicationTables(client)).toEqual([]);
    expect(await listEnums(client)).toEqual([]);
    expect(await extensionInstalled(client, "citext")).toBe(false);
    expect(await extensionInstalled(client, "pg_trgm")).toBe(false);

    // 2. Apply committed migrations (deploy — never db push / migrate reset).
    await runMigrateDeploy(config);

    // 3. Migration history records 0001–0004, in order, all successfully applied.
    const migrations = await client.$queryRawUnsafe<MigrationRow[]>(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM "_prisma_migrations" ORDER BY started_at`,
    );
    expect(migrations.map((row) => row.migration_name)).toEqual([
      ...EXPECTED_MIGRATIONS,
    ]);
    for (const migration of migrations) {
      expect(migration.finished_at).not.toBeNull();
      expect(migration.rolled_back_at).toBeNull();
    }

    // 4. Exactly the eight tables (foundation + vehicle/image/inquiry). Rental
    //    packages are NOT created in this phase.
    const tables = await listApplicationTables(client);
    expect(tables).toEqual([...EXPECTED_TABLES]);
    expect(tables).not.toContain("rental_packages");

    // 5. Exactly the ten enums.
    expect(await listEnums(client)).toEqual([...EXPECTED_ENUMS]);

    // 6. Both required extensions are enabled by the migrations.
    expect(await extensionInstalled(client, "citext")).toBe(true);
    expect(await extensionInstalled(client, "pg_trgm")).toBe(true);

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
