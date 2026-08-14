import "server-only";

import { prisma } from "@/server/db/prisma";
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
