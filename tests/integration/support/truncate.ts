import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Between-test data cleanup for the integration harness.
 *
 * Exactly one guarded `TRUNCATE` runs over a fixed allowlist of the Phase 1
 * application tables. `_prisma_migrations` is deliberately excluded so migration
 * history survives. No table is ever discovered dynamically: only these five
 * hard-coded identifiers are ever truncated, so `CASCADE` cannot reach beyond
 * the verified test database's application tables.
 */

/**
 * The Phase 1 application tables, in the exact allowlist required for Group 2.
 * Ordering is irrelevant because a single statement truncates them together
 * with CASCADE; every foreign key among them targets a table in this list.
 */
export const TRUNCATE_ALLOWLIST = [
  "admin_audit_log",
  "business_settings",
  "media_deletion_queue",
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
