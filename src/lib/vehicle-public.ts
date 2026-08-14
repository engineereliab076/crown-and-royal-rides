import { formatTzs } from "@/lib/money";
import type { VehiclePublicDetailDTO } from "@/server/modules/vehicles/dto";

export interface VehiclePublicPresentation {
  readonly title: string;
  readonly description: string;
  readonly price: string;
  readonly bodyType: string;
  readonly condition: string;
  readonly transmission: string;
  readonly fuelType: string;
  readonly driverOption: string;
  readonly coverUrl: string | null;
  readonly coverAlt: string;
}

function pretty(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function vehiclePublicPresentation(
  vehicle: VehiclePublicDetailDTO,
): VehiclePublicPresentation {
  const title = `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`;
  return {
    title,
    description:
      vehicle.description?.trim() ||
      `${title} available from Crown and Royal Rides.`,
    price:
      vehicle.salePrice === null
        ? "Price unavailable"
        : formatTzs(vehicle.salePrice),
    bodyType: pretty(vehicle.bodyType),
    condition: pretty(vehicle.condition),
    transmission: pretty(vehicle.transmission),
    fuelType: pretty(vehicle.fuelType),
    driverOption: pretty(vehicle.driverOption),
    coverUrl: vehicle.coverImage?.url ?? null,
    coverAlt:
      vehicle.coverImage?.altText ?? `${vehicle.brandName} ${vehicle.model}`,
  };
}
