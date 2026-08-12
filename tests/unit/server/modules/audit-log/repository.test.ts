import { describe, expect, it, vi } from "vitest";

import {
  type AuditPrismaClient,
  createPrismaAuditLogRepository,
} from "@/server/modules/audit-log/repository";

describe("Prisma audit-log repository", () => {
  it("uses stable descending ordering and cursor pagination", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: BigInt(3) },
        { id: BigInt(2) },
        { id: BigInt(1) },
      ]);
    const repository = createPrismaAuditLogRepository({
      adminAuditLog: { findMany },
    } as unknown as AuditPrismaClient);
    const page = await repository.list({ limit: 2 });

    expect(findMany.mock.calls[0]?.[0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(findMany.mock.calls[0]?.[0].take).toBe(3);
    expect(page.items.map((row) => row.id)).toEqual([BigInt(3), BigInt(2)]);
    expect(page.nextCursor).toBe(BigInt(2));
  });

  it("exposes append and list only (application append-only convention)", () => {
    const repository = createPrismaAuditLogRepository({
      adminAuditLog: {},
    } as unknown as AuditPrismaClient);
    expect(Object.keys(repository).sort()).toEqual(["append", "list"]);
  });
});
