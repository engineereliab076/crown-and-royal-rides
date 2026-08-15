import "server-only";

import { revalidatePublicVehicle } from "@/server/cache/vehicles";
import { prisma } from "@/server/db/prisma";
import { runInTransaction } from "@/server/db/transaction";
import { getIntegrationContainer } from "@/server/integrations/container";
import { createPrismaMediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";
import { createPrismaVehicleImageRepository } from "@/server/modules/vehicle-images/repository";
import {
  createVehicleImageService,
  type VehicleImageService,
} from "@/server/modules/vehicle-images/service";

/**
 * Composition root for the canonical vehicle-image gallery service (Phase 4).
 *
 * This is the single service behind every gallery operation — attach (including
 * the first-image-becomes-cover behavior that Phase 3 exposed as a dedicated
 * cover flow), reorder, set-cover, alt-text, and remove — plus signed upload
 * authorization. Each mutation runs in one interactive transaction whose callback
 * receives transaction-scoped repositories (gallery + deletion queue); reads and
 * the post-commit deletion resolve/failure use base-client repositories.
 *
 * Wired lazily so this module has no import-time side effects.
 */

let singleton: VehicleImageService | undefined;

export function getVehicleImageService(): VehicleImageService {
  if (singleton !== undefined) return singleton;
  const integrations = getIntegrationContainer();
  singleton = createVehicleImageService({
    repository: createPrismaVehicleImageRepository(prisma),
    deletionQueue: createPrismaMediaDeletionQueueRepository(prisma),
    transaction: (operation) =>
      runInTransaction(
        async (tx) =>
          operation({
            images: createPrismaVehicleImageRepository(tx),
            deletionQueue: createPrismaMediaDeletionQueueRepository(tx),
          }),
        undefined,
        prisma,
      ),
    mediaStorage: () => integrations.mediaStorage,
    errorReporter: () => integrations.errorReporter,
    revalidate: (slug) => revalidatePublicVehicle(slug),
  });
  return singleton;
}
