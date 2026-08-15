import "server-only";

import { prisma } from "@/server/db/prisma";
import { createPrismaPublicVehicleRepository } from "@/server/modules/vehicles/public-repository";
import {
  createPublicVehicleService,
  type PublicVehicleCatalogueService,
} from "@/server/modules/vehicles/public-service";
import { createPrismaVehicleRepository } from "@/server/modules/vehicles/repository";
import {
  createVehicleService,
  type VehicleService,
} from "@/server/modules/vehicles/service";

let singleton: VehicleService | undefined;

export function getPublicVehicleService(): VehicleService {
  singleton ??= createVehicleService({
    repository: createPrismaVehicleRepository(prisma),
  });
  return singleton;
}

let catalogueSingleton: PublicVehicleCatalogueService | undefined;

/** The public catalogue read service used by the homepage and `/cars` pages. */
export function getPublicCatalogueService(): PublicVehicleCatalogueService {
  catalogueSingleton ??= createPublicVehicleService({
    repository: createPrismaPublicVehicleRepository(prisma),
  });
  return catalogueSingleton;
}
