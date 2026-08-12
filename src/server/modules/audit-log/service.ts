import "server-only";

import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import type { AuditLogRepository } from "@/server/modules/audit-log/repository";
import {
  auditLogListSchema,
  type AuditLogListInput,
} from "@/server/modules/audit-log/schemas";
import { AppError } from "@/server/http/errors";

export interface PublicAuditRecord {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: unknown;
  readonly ipHash: string;
  readonly createdAt: Date;
}

export interface PublicAuditPage {
  readonly items: readonly PublicAuditRecord[];
  readonly nextCursor: string | null;
}

export interface AuditLogService {
  list(
    actor: AuthenticatedActor,
    input: AuditLogListInput,
  ): Promise<PublicAuditPage>;
}

export function createAuditLogService(input: {
  repository: AuditLogRepository;
}): AuditLogService {
  return {
    async list(actor, rawInput) {
      requireCapability(actor, "audit:read");
      const parsed = auditLogListSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new AppError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Invalid audit-log query.",
        });
      }
      const page = await input.repository.list(parsed.data);
      return {
        items: page.items.map((record) => ({
          ...record,
          id: record.id.toString(),
        })),
        nextCursor: page.nextCursor?.toString() ?? null,
      };
    },
  };
}
