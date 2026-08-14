import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import type { VehiclePublicDetailDTO } from "@/server/modules/vehicles/dto";

const VEHICLE_REVALIDATE_SECONDS = 300;

export function vehicleCacheTag(slug: string): string {
  return `vehicle:${slug}`;
}

export function revalidateVehicle(slug: string): void {
  revalidateTag(vehicleCacheTag(slug));
}

export async function getCachedPublicVehicle(
  slug: string,
  load: () => Promise<VehiclePublicDetailDTO>,
): Promise<VehiclePublicDetailDTO> {
  return unstable_cache(load, ["public-vehicle", slug], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [vehicleCacheTag(slug)],
  })();
}
