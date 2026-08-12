import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export interface AuditRecord {
  readonly id: bigint;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Prisma.JsonValue;
  readonly ipHash: string;
  readonly createdAt: Date;
}

export interface AppendAuditRecord {
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Prisma.InputJsonValue;
  readonly ipHash: string;
}

export interface AuditListQuery {
  readonly limit: number;
  readonly cursor?: bigint;
}

export interface AuditRecordPage {
  readonly items: readonly AuditRecord[];
  readonly nextCursor: bigint | null;
}

export interface AuditLogRepository {
  append(input: AppendAuditRecord): Promise<AuditRecord>;
  list(input: AuditListQuery): Promise<AuditRecordPage>;
}

export type AuditPrismaClient = Pick<PrismaClient, "adminAuditLog">;

const AUDIT_SELECT = {
  id: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  ipHash: true,
  createdAt: true,
} as const;

export function createPrismaAuditLogRepository(
  client: AuditPrismaClient,
): AuditLogRepository {
  return {
    async append(input) {
      return client.adminAuditLog.create({
        data: input,
        select: AUDIT_SELECT,
      });
    },

    async list(input) {
      const rows = await client.adminAuditLog.findMany({
        select: AUDIT_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor === undefined
          ? {}
          : { cursor: { id: input.cursor }, skip: 1 }),
      });
      const hasNext = rows.length > input.limit;
      const items = hasNext ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasNext ? (items.at(-1)?.id ?? null) : null,
      };
    },
  };
}
