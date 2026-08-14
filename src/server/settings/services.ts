import "server-only";

import { getCachedPublicSettings } from "@/server/cache/settings";
import { prisma } from "@/server/db/prisma";
import { createPrismaSettingsRepository } from "@/server/modules/settings/repository";
import { createPublicSettingsService } from "@/server/modules/settings/public";

export function getPublicSettings() {
  return createPublicSettingsService({
    repository: createPrismaSettingsRepository(prisma),
    cache: getCachedPublicSettings,
  }).getPublicSettings();
}
