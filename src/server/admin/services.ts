import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/server/db/prisma";
import { runInTransaction } from "@/server/db/transaction";
import { getClientIp } from "@/server/http/client-ip";
import { revalidateVehicle } from "@/server/cache/vehicles";
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
import { createPrismaInquiryRepository } from "@/server/modules/inquiries/repository";
import {
  createInquiryService,
  type InquiryService,
} from "@/server/modules/inquiries/service";
import {
  createSettingsService,
  type SettingsService,
} from "@/server/modules/settings/service";
import { createPrismaVehicleRepository } from "@/server/modules/vehicles/repository";
import {
  createVehicleService,
  type VehicleService,
} from "@/server/modules/vehicles/service";
import {
  createVehicleMediaService,
  type VehicleMediaService,
} from "@/server/modules/vehicles/media-service";

const LOCAL_HASH_SECRET_FALLBACK =
  "crown-and-royal-rides:admin-audit:local-development-fallback";

export interface AdminServices {
  readonly administratorService: AdministratorService;
  readonly auditLogService: AuditLogService;
  readonly settingsService: SettingsService;
  readonly vehicleService: VehicleService;
  readonly vehicleMediaService: VehicleMediaService;
  readonly inquiryService: InquiryService;
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
  const vehicleRepository = createPrismaVehicleRepository(prisma);
  const vehicleService = createVehicleService({
    repository: vehicleRepository,
    revalidateVehicle,
    reportCacheFailure: async (context) => {
      try {
        await integrations.errorReporter.captureMessage(
          "Published vehicle cache revalidation failed.",
          "warning",
          {
            correlationId: context.correlationId,
            actorId: context.actorId,
            additional: { operation: "vehicle-publication-revalidation" },
          },
        );
      } catch {}
    },
  });
  const vehicleMediaService = createVehicleMediaService({
    repository: vehicleRepository,
    mediaStorage: () => integrations.mediaStorage,
    errorReporter: () => integrations.errorReporter,
  });
  const inquiryService = createInquiryService({
    repository: createPrismaInquiryRepository(prisma),
  });

  return Object.freeze({
    administratorService,
    auditLogService,
    settingsService,
    vehicleService,
    vehicleMediaService,
    inquiryService,
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
