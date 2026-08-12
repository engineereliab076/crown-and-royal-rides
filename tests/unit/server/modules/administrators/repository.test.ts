import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  type AdministratorPrismaClient,
  createPrismaAdministratorRepository,
} from "@/server/modules/administrators/repository";

function fakeClient(
  adminUser: Record<string, unknown>,
): AdministratorPrismaClient {
  return {
    adminUser,
    $queryRaw: vi.fn(),
  } as unknown as AdministratorPrismaClient;
}

describe("Prisma administrator repository", () => {
  it("lists with an explicit public select that excludes passwordHash", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = createPrismaAdministratorRepository(
      fakeClient({ findMany, count }),
    );
    await repository.list({ page: 2, limit: 10, role: AdminRole.owner });

    const args = findMany.mock.calls[0]?.[0];
    expect(args.select).not.toHaveProperty("passwordHash");
    expect(args.select).not.toHaveProperty("createdUsers");
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual([{ email: "asc" }, { id: "asc" }]);
  });

  it("increments sessionVersion for role, deactivation, and reset only", async () => {
    const update = vi.fn().mockResolvedValue({});
    const repository = createPrismaAdministratorRepository(
      fakeClient({ update }),
    );

    await repository.setRole("id", AdminRole.manager);
    await repository.deactivate("id");
    await repository.resetPassword("id", "$argon2id$hash");
    await repository.reactivate("id");

    expect(update.mock.calls[0]?.[0].data.sessionVersion).toEqual({
      increment: 1,
    });
    expect(update.mock.calls[1]?.[0].data.sessionVersion).toEqual({
      increment: 1,
    });
    expect(update.mock.calls[2]?.[0].data).toMatchObject({
      passwordHash: "$argon2id$hash",
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    });
    expect(update.mock.calls[3]?.[0].data).toEqual({ isActive: true });
    for (const call of update.mock.calls) {
      expect(call[0].select).not.toHaveProperty("passwordHash");
    }
  });
});
