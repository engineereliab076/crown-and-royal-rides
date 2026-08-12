import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { AdminRole } from "../src/generated/prisma/enums";
import { hashPassword } from "../src/server/modules/auth/password";
import { emailSchema } from "../src/server/modules/auth/schemas";
import {
  SeedConflictError,
  type SeedStartupConfiguration,
} from "./seed-preconditions";

/** How a password is hashed. Injectable so tests avoid slow real hashing. */
export type SeedPasswordHasher = (password: string) => Promise<string>;

export interface FirstOwnerResult {
  /** True when a new owner was created; false when one already existed. */
  readonly created: boolean;
}

/**
 * Create the first OWNER administrator, idempotently.
 *
 * The email is validated and normalized, the password is hashed with the
 * production Argon2id helper, and only the resulting `passwordHash` is stored —
 * the plaintext is never sent to Prisma. The serializable transaction first
 * checks globally for an existing owner. If one exists, every account remains
 * untouched and `created: false` is returned. A non-owner already using the
 * requested email produces a safe conflict. Nothing outside `admin_users` is
 * written.
 */
export async function createFirstOwner(
  prisma: PrismaClient,
  configuration: SeedStartupConfiguration,
  hashPasswordFn: SeedPasswordHasher = hashPassword,
): Promise<FirstOwnerResult> {
  const email = emailSchema.parse(configuration.ownerEmail);

  return prisma.$transaction(
    async (tx) => {
      const existingOwner = await tx.adminUser.findFirst({
        where: { role: AdminRole.owner },
        select: { id: true },
      });
      if (existingOwner !== null) return { created: false };

      const existingEmail = await tx.adminUser.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingEmail !== null) throw new SeedConflictError();

      const passwordHash = await hashPasswordFn(configuration.ownerPassword);
      const name = email.split("@")[0] ?? "Owner";

      await tx.adminUser.create({
        data: {
          email,
          name,
          passwordHash,
          role: AdminRole.owner,
          isActive: true,
          // A freshly seeded owner must rotate the bootstrap password on first
          // login (this also matches the schema default).
          mustChangePassword: true,
        },
      });

      return { created: true };
    },
    {
      isolationLevel: "Serializable" satisfies Prisma.TransactionIsolationLevel,
    },
  );
}

export function seedOutcomeMessage(result: FirstOwnerResult): string {
  return result.created
    ? "Seed: owner administrator created."
    : "Seed: owner administrator already exists; no changes made.";
}
