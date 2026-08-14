import "server-only";

import { prisma } from "@/server/db/prisma";
import { getIntegrationContainer } from "@/server/integrations/container";
import { createPrismaMediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";
import {
  createMediaDeletionRetryService,
  type MediaDeletionRetryService,
} from "@/server/modules/media-deletion-queue/retry-service";

/**
 * Composition root for the media-deletion retry worker (Phase 4, Group 2).
 * Wired lazily so this module has no import-time side effects.
 */

let singleton: MediaDeletionRetryService | undefined;

export function getMediaDeletionRetryService(): MediaDeletionRetryService {
  if (singleton !== undefined) return singleton;
  const integrations = getIntegrationContainer();
  singleton = createMediaDeletionRetryService({
    repository: createPrismaMediaDeletionQueueRepository(prisma),
    mediaStorage: () => integrations.mediaStorage,
  });
  return singleton;
}
