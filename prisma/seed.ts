import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { parseEnv } from "../src/lib/env.schema";
import {
  assertPhase2PasswordHashingAvailable,
  assertSeedStartupPreconditions,
  safeSeedErrorMessage,
} from "./seed-preconditions";

async function main(): Promise<void> {
  const environment = parseEnv({ ...process.env });
  const configuration = assertSeedStartupPreconditions(environment);

  // Phase 2 will provide Argon2id hashing and owner creation. Until then this
  // guard deliberately runs before constructing Prisma or touching a database.
  assertPhase2PasswordHashingAvailable();

  // Seeding is an explicit, one-off administrative operation, so it uses the
  // direct database URL rather than the pooled application runtime URL.
  const adapter = new PrismaPg({
    connectionString: configuration.directDatabaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeSeedErrorMessage(error)}\n`);
  process.exitCode = 1;
});
