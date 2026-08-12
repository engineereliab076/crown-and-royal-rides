import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import type { AuditLogRepository } from "@/server/modules/audit-log/repository";
import { createAuditLogService } from "@/server/modules/audit-log/service";

const actorId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("audit-log service", () => {
  it("allows owners and serializes bigint cursors and IDs safely", async () => {
    const repository: AuditLogRepository = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: BigInt(7),
            actorId,
            action: "administrator.created",
            targetType: "administrator",
            targetId: "target",
            metadata: {},
            ipHash: "hash",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        nextCursor: BigInt(7),
      }),
    };
    const page = await createAuditLogService({ repository }).list(
      { id: actorId, role: AdminRole.owner },
      { limit: "1" },
    );
    expect(page.items[0]?.id).toBe("7");
    expect(page.nextCursor).toBe("7");
  });

  it("denies managers before repository access", async () => {
    const list = vi.fn();
    const service = createAuditLogService({
      repository: { append: vi.fn(), list } as unknown as AuditLogRepository,
    });
    await expect(
      service.list({ id: actorId, role: AdminRole.manager }, {}),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
    expect(list).not.toHaveBeenCalled();
  });
});
