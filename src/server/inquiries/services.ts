import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/server/db/prisma";
import { getIntegrationContainer } from "@/server/integrations/container";
import { createPrismaInquiryRepository } from "@/server/modules/inquiries/repository";
import {
  createInquiryService,
  type InquiryService,
} from "@/server/modules/inquiries/service";
import { createPrismaSettingsRepository } from "@/server/modules/settings/repository";

const LOCAL_HASH_SECRET_FALLBACK =
  "crown-and-royal-rides:purchase-inquiry:local-development-fallback";

export interface InquiryRuntimeServices {
  readonly inquiryService: InquiryService;
  readonly settingsRepository: ReturnType<
    typeof createPrismaSettingsRepository
  >;
  readonly integrations: ReturnType<typeof getIntegrationContainer>;
  readonly hashSecret: string;
  readonly publicOrigin: string;
}

let singleton: InquiryRuntimeServices | undefined;

export function getInquiryRuntimeServices(): InquiryRuntimeServices {
  if (singleton !== undefined) return singleton;
  const integrations = getIntegrationContainer();
  const usesSharedLimiter =
    integrations.mode.providers.rateLimiter !== "in-memory";
  const hashSecret = env.IP_HASH_SECRET ?? LOCAL_HASH_SECRET_FALLBACK;
  if (usesSharedLimiter && env.IP_HASH_SECRET === undefined) {
    throw new Error("IP_HASH_SECRET is required for inquiry rate limiting.");
  }
  const repository = createPrismaInquiryRepository(prisma);
  const built: InquiryRuntimeServices = Object.freeze({
    inquiryService: createInquiryService({ repository }),
    settingsRepository: createPrismaSettingsRepository(prisma),
    integrations,
    hashSecret,
    publicOrigin:
      env.NEXT_PUBLIC_APP_URL ?? env.APP_ORIGIN ?? "http://localhost:3000",
  });
  singleton = built;
  return built;
}
