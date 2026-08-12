import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/server/db/prisma";
import { runInTransaction } from "@/server/db/transaction";
import { getClientIp } from "@/server/http/client-ip";
import { getIntegrationContainer } from "@/server/integrations/container";
import { createPrismaAdministratorRepository } from "@/server/modules/administrators/repository";
import { createAdministratorRateLimiter } from "@/server/modules/administrators/rate-limit";
import {
  type AdministratorService,
  createAdministratorService,
} from "@/server/modules/administrators/service";
import {
  createAuditContext,
  type AuditContext,
} from "@/server/modules/audit-log/context";
import { createPrismaAuditLogRepository } from "@/server/modules/audit-log/repository";
import {
  type AuditLogService,
  createAuditLogService,
} from "@/server/modules/audit-log/service";
import { createPrismaSettingsRepository } from "@/server/modules/settings/repository";
import {
  createSettingsService,
  type SettingsService,
} from "@/server/modules/settings/service";

const LOCAL_HASH_SECRET_FALLBACK =
  "crown-and-royal-rides:admin-audit:local-development-fallback";

export interface AdminServices {
  readonly administratorService: AdministratorService;
  readonly auditLogService: AuditLogService;
  readonly settingsService: SettingsService;
  createRequestAuditContext(
    headers: Headers,
    correlationId: string,
  ): AuditContext;
}

let singleton: AdminServices | undefined;

function resolveHashSecret(usesSharedBackend: boolean): string {
  const secret = env.IP_HASH_SECRET;
  if (typeof secret === "string" && secret.length >= 32) return secret;
  if (usesSharedBackend) {
    throw new Error(
      "IP_HASH_SECRET is required for administrator rate limiting and audit IP hashing.",
    );
  }
  return LOCAL_HASH_SECRET_FALLBACK;
}

function build(): AdminServices {
  const integrations = getIntegrationContainer();
  const hashSecret = resolveHashSecret(
    integrations.mode.providers.rateLimiter !== "in-memory",
  );
  const administratorRepository = createPrismaAdministratorRepository(prisma);
  const auditLogRepository = createPrismaAuditLogRepository(prisma);
  const rateLimiter = createAdministratorRateLimiter({
    rateLimiter: integrations.rateLimiter,
    hashSecret,
  });

  const administratorService = createAdministratorService({
    repository: administratorRepository,
    rateLimiter,
    transaction: async (operation, options) =>
      runInTransaction(
        async (tx) =>
          operation({
            administrators: createPrismaAdministratorRepository(tx),
            auditLog: createPrismaAuditLogRepository(tx),
          }),
        options,
        prisma,
      ),
  });
  const auditLogService = createAuditLogService({
    repository: auditLogRepository,
  });
  const settingsService = createSettingsService({
    repository: createPrismaSettingsRepository(prisma),
    transaction: async (operation) =>
      runInTransaction(
        async (tx) =>
          operation({
            settings: createPrismaSettingsRepository(tx),
            auditLog: createPrismaAuditLogRepository(tx),
          }),
        undefined,
        prisma,
      ),
  });

  return Object.freeze({
    administratorService,
    auditLogService,
    settingsService,
    createRequestAuditContext(headers: Headers, correlationId: string) {
      return createAuditContext({
        correlationId,
        clientIp: getClientIp(headers),
        hashSecret,
      });
    },
  });
}

export function getAdminServices(): AdminServices {
  singleton ??= build();
  return singleton;
}
