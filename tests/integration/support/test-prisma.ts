import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Construct a Prisma client for the integration harness, bound to the pooled
 * test database URL via the `pg` driver adapter.
 *
 * This deliberately does NOT import the application's `prisma` singleton: the
 * destructive harness must only ever touch the verified test database, so it
 * owns its own client whose connection string has passed the safety gate. Each
 * suite creates one and disconnects it in teardown.
 */
export function createTestPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
