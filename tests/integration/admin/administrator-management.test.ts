import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { runInTransaction } from "@/server/db/transaction";
import { createPrismaAdministratorRepository } from "@/server/modules/administrators/repository";
import { createAdministratorService } from "@/server/modules/administrators/service";
import { createPrismaAuditLogRepository } from "@/server/modules/audit-log/repository";
import { createPrismaAuthRepository } from "@/server/modules/auth/repository";
import { createAuthService } from "@/server/modules/auth/service";

import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();
const HASH = "$argon2id$v=19$m=65536,p=4,t=3$fixture$fixture";
const context = {
  correlationId: "integration-correlation",
  ipHash: "hashed-ip",
};

function client(): PrismaClient {
  return suite.getClient();
}

async function createAdmin(input: {
  email: string;
  role: AdminRole;
  createdById?: string;
}) {
  return client().adminUser.create({
    data: {
      email: input.email,
      name: "Integration Admin",
      role: input.role,
      passwordHash: HASH,
      mustChangePassword: false,
      createdById: input.createdById,
    },
  });
}

function service(options: { auditThrowsAfterAppend?: boolean } = {}) {
  const repository = createPrismaAdministratorRepository(client());
  return createAdministratorService({
    repository,
    hashPassword: async () => "$argon2id$new-hash",
    generateTemporaryPassword: () => "Temporary-Password-9!",
    rateLimiter: { checkPasswordReset: async () => ({ allowed: true }) },
    transaction: async (operation, transactionOptions) =>
      runInTransaction(
        async (tx) => {
          const audit = createPrismaAuditLogRepository(tx);
          return operation({
            administrators: createPrismaAdministratorRepository(tx),
            auditLog: options.auditThrowsAfterAppend
              ? {
                  ...audit,
                  async append(input) {
                    const row = await audit.append(input);
                    throw new Error(`audit failure after ${row.id.toString()}`);
                  },
                }
              : audit,
          });
        },
        transactionOptions,
        client(),
      ),
  });
}

describe("administrator management transactions", () => {
  it("leaves exactly one active owner under concurrent deactivate/demote requests", async () => {
    const first = await createAdmin({
      email: "owner-one@example.com",
      role: AdminRole.owner,
    });
    const second = await createAdmin({
      email: "owner-two@example.com",
      role: AdminRole.owner,
      createdById: first.id,
    });
    const administratorService = service();

    const results = await Promise.allSettled([
      administratorService.deactivate(
        { id: first.id, role: AdminRole.owner },
        first.id,
        context,
      ),
      administratorService.setRole(
        { id: second.id, role: AdminRole.owner },
        second.id,
        { role: AdminRole.manager },
        context,
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected?.status === "rejected" ? rejected.reason : null,
    ).toMatchObject({
      status: 409,
      code: "LAST_ACTIVE_OWNER",
    });
    expect(
      await client().adminUser.count({
        where: { role: AdminRole.owner, isActive: true },
      }),
    ).toBe(1);
    expect(await client().adminAuditLog.count()).toBe(1);
  });

  it("rolls back both the mutation and an appended audit row when audit handling fails", async () => {
    const actor = await createAdmin({
      email: "actor@example.com",
      role: AdminRole.owner,
    });
    const target = await createAdmin({
      email: "target@example.com",
      role: AdminRole.manager,
      createdById: actor.id,
    });

    await expect(
      service({ auditThrowsAfterAppend: true }).setRole(
        { id: actor.id, role: AdminRole.owner },
        target.id,
        { role: AdminRole.owner },
        context,
      ),
    ).rejects.toThrow("audit failure");

    expect(
      await client().adminUser.findUnique({
        where: { id: target.id },
        select: { role: true, sessionVersion: true },
      }),
    ).toEqual({
      role: AdminRole.manager,
      sessionVersion: 1,
    });
    expect(await client().adminAuditLog.count()).toBe(0);
  });

  it("invalidates old sessions after role change, deactivation, and reset", async () => {
    const actor = await createAdmin({
      email: "session-actor@example.com",
      role: AdminRole.owner,
    });
    const roleTarget = await createAdmin({
      email: "role@example.com",
      role: AdminRole.manager,
      createdById: actor.id,
    });
    const inactiveTarget = await createAdmin({
      email: "inactive@example.com",
      role: AdminRole.manager,
      createdById: actor.id,
    });
    const resetTarget = await createAdmin({
      email: "reset@example.com",
      role: AdminRole.manager,
      createdById: actor.id,
    });
    const administratorService = service();
    const authService = createAuthService({
      repository: createPrismaAuthRepository(client()),
    });

    await administratorService.setRole(
      { id: actor.id, role: AdminRole.owner },
      roleTarget.id,
      { role: AdminRole.owner },
      context,
    );
    await administratorService.deactivate(
      { id: actor.id, role: AdminRole.owner },
      inactiveTarget.id,
      context,
    );
    await administratorService.resetPassword(
      { id: actor.id, role: AdminRole.owner },
      resetTarget.id,
      context,
    );

    for (const id of [roleTarget.id, inactiveTarget.id, resetTarget.id]) {
      await expect(
        authService.validateSession({ id, sessionVersion: 1 }),
      ).resolves.toBeNull();
    }
  });
});
