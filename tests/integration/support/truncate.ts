import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Between-test data cleanup for the integration harness.
 *
 * Exactly one guarded `TRUNCATE` runs over a fixed allowlist of application
 * tables. `_prisma_migrations` is deliberately excluded so migration history
 * survives. No table is ever discovered dynamically: only these hard-coded
 * identifiers are ever truncated, so `CASCADE` cannot reach beyond the verified
 * test database's application tables.
 */

/**
 * The application tables, in a fixed allowlist. Ordering is irrelevant because a
 * single statement truncates them together with CASCADE; every foreign key among
 * them targets a table in this list (Phase 1 foundation plus the Phase 3
 * vehicle/image/inquiry tables).
 */
export const TRUNCATE_ALLOWLIST = [
  "admin_audit_log",
  "business_settings",
  "media_deletion_queue",
  "inquiries",
  "vehicle_images",
  "vehicles",
  "brands",
  "admin_users",
] as const;

const TRUNCATE_STATEMENT = `TRUNCATE TABLE ${TRUNCATE_ALLOWLIST.map(
  (table) => `"${table}"`,
).join(", ")} RESTART IDENTITY CASCADE`;

/**
 * Truncate every allowlisted application table, resetting identity sequences.
 * Preserves `_prisma_migrations`.
 */
export async function truncateAllTables(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(TRUNCATE_STATEMENT);
}
