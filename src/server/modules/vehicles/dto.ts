import "server-only";

import { toShillings } from "@/lib/money";
import type {
  VehicleAdminRecord,
  VehiclePublicRecord,
} from "@/server/modules/vehicles/repository";

export type PublicationRequirement =
  "coverImage" | "saleMode" | "salePrice" | "description";

export interface VehicleImageDTO {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly isCover: boolean;
  readonly sortOrder: number;
}

export interface VehicleCardDTO {
  readonly id: string;
  readonly slug: string;
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
  readonly saleStatus: string | null;
  readonly salePrice: number | null;
  readonly coverImage: VehicleImageDTO | null;
}

export interface VehiclePublicDetailDTO extends VehicleCardDTO {
  readonly bodyType: string;
  readonly condition: string;
  readonly transmission: string;
  readonly fuelType: string;
  readonly driverOption: string;
  readonly isForSale: boolean;
  readonly description: string | null;
  readonly images: readonly VehicleImageDTO[];
}

export interface VehicleAdminDTO extends VehiclePublicDetailDTO {
  readonly brandId: string;
  readonly listingState: string;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publicationReadiness: {
    readonly ready: boolean;
    readonly missing: readonly PublicationRequirement[];
  };
}

function mapImage(image: {
  id: string;
  secureUrl: string;
  width: number;
  height: number;
  altText: string | null;
  isCover: boolean;
  sortOrder: number;
}): VehicleImageDTO {
  return {
    id: image.id,
    url: image.secureUrl,
    width: image.width,
    height: image.height,
    altText: image.altText,
    isCover: image.isCover,
    sortOrder: image.sortOrder,
  };
}

export function publicationRequirements(vehicle: {
  isForSale: boolean;
  saleStatus: string | null;
  salePrice: bigint | null;
  description: string | null;
  images: readonly { isCover: boolean }[];
}): readonly PublicationRequirement[] {
  const missing: PublicationRequirement[] = [];
  if (!vehicle.images.some((image) => image.isCover))
    missing.push("coverImage");
  if (!vehicle.isForSale || vehicle.saleStatus === null)
    missing.push("saleMode");
  if (vehicle.salePrice === null || vehicle.salePrice <= BigInt(0)) {
    missing.push("salePrice");
  }
  if ((vehicle.description?.trim().length ?? 0) < 40) {
    missing.push("description");
  }
  return missing;
}

function publicFields(vehicle: VehiclePublicRecord) {
  const images = vehicle.images.map(mapImage);
  return {
    id: vehicle.id,
    slug: vehicle.slug,
    brandName: vehicle.brandName,
    model: vehicle.model,
    year: vehicle.year,
    bodyType: vehicle.bodyType,
    condition: vehicle.condition,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuelType,
    driverOption: vehicle.driverOption,
    isForSale: vehicle.isForSale,
    saleStatus: vehicle.saleStatus,
    salePrice:
      vehicle.salePrice === null ? null : toShillings(vehicle.salePrice),
    description: vehicle.description,
    coverImage: images.find((image) => image.isCover) ?? null,
    images,
  } as const;
}

export function toVehicleCardDTO(vehicle: VehiclePublicRecord): VehicleCardDTO {
  const mapped = publicFields(vehicle);
  return {
    id: mapped.id,
    slug: mapped.slug,
    brandName: mapped.brandName,
    model: mapped.model,
    year: mapped.year,
    saleStatus: mapped.saleStatus,
    salePrice: mapped.salePrice,
    coverImage: mapped.coverImage,
  };
}

export function toVehiclePublicDetailDTO(
  vehicle: VehiclePublicRecord,
): VehiclePublicDetailDTO {
  return publicFields(vehicle);
}

export function toVehicleAdminDTO(
  vehicle: VehicleAdminRecord,
): VehicleAdminDTO {
  const mapped = publicFields(vehicle);
  const missing = publicationRequirements(vehicle);
  return {
    ...mapped,
    brandId: vehicle.brandId,
    listingState: vehicle.listingState,
    publishedAt: vehicle.publishedAt?.toISOString() ?? null,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    publicationReadiness: { ready: missing.length === 0, missing },
  };
}
