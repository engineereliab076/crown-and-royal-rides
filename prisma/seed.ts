import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { createFirstOwner, seedOutcomeMessage } from "./first-owner";
import {
  parseSeedEnvironment,
  safeSeedErrorMessage,
} from "./seed-preconditions";

async function main(): Promise<void> {
  const configuration = parseSeedEnvironment(process.env);

  // Seeding is an explicit, one-off administrative operation, so it uses the
  // least-privilege application URL. Production validation requires the
  // crr_application role through Neon's pooled endpoint. The connection string
  // is handed to the adapter and never printed or logged.
  const adapter = new PrismaPg({
    connectionString: configuration.databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const result = await createFirstOwner(prisma, configuration);
    process.stdout.write(`${seedOutcomeMessage(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeSeedErrorMessage(error)}\n`);
  process.exitCode = 1;
});
