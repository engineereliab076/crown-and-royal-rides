import "server-only";

import type { ParsedVehicleQuery } from "@/lib/vehicle-filters";
import { getCachedVehicleSearch } from "@/server/cache/vehicles";
import { prisma } from "@/server/db/prisma";
import {
  attachIgnoredFilters,
  type VehicleCatalogueSearchResult,
} from "@/server/modules/vehicles/public-dto";
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

/**
 * Run a parsed catalogue query through the cached normalized execution and
 * re-attach the request-specific ignored-filter report. The canonical cache key
 * excludes `ignoredFilters`, so the report never leaks or collides through the
 * shared data cache. This is the single entry point Group 2 pages will call.
 */
export async function searchPublicCatalogue(
  parsed: ParsedVehicleQuery,
): Promise<VehicleCatalogueSearchResult> {
  const service = getPublicCatalogueService();
  const query = {
    mode: parsed.mode,
    filters: parsed.filters,
    sort: parsed.sort,
    page: parsed.page,
  };
  const normalized = await getCachedVehicleSearch(query, () =>
    service.executeCatalogueSearch(query),
  );
  return attachIgnoredFilters(normalized, parsed.ignoredFilters);
}
