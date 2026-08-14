import "server-only";

import { toShillings } from "@/lib/money";
import type {
  VehicleAdminRecord,
  VehiclePublicRecord,
} from "@/server/modules/vehicles/repository";

export const PUBLICATION_REQUIREMENTS = {
  brand: "Brand",
  model: "Model",
  year: "Year",
  bodyType: "Body type",
  condition: "Condition",
  transmission: "Transmission",
  fuelType: "Fuel type",
  drivetrain: "Drivetrain",
  location: "Location",
  description: "Description of at least 40 characters",
  image: "At least one image",
  coverImage: "Exactly one cover image",
  imageAltText: "Alt text for every image",
  commercialMode: "At least one sale or rental mode",
  saleStatus: "Sale status",
  salePrice: "Positive sale price",
  rentalStatus: "Rental status",
  rentalDailyPrice: "Positive daily rental price",
  minRentalDays: "Minimum rental days",
  mileageKm: "Mileage for a used vehicle",
  driverNote: "Driver arrangement note",
  exteriorColor: "Exterior colour",
  seats: "Seat count",
} as const;

export type PublicationRequirement = keyof typeof PUBLICATION_REQUIREMENTS;
export interface PublicationChecklistItem {
  readonly key: PublicationRequirement;
  readonly label: string;
  readonly met: boolean;
}
export interface PublicationReadiness {
  readonly ready: boolean;
  readonly missing: readonly PublicationRequirement[];
  readonly checklist: readonly PublicationChecklistItem[];
}

export type VehicleBadge =
  | "archived"
  | "draft"
  | "sold"
  | "rented"
  | "reserved"
  | "sale-and-rent"
  | "for-sale"
  | "for-rent"
  | "unavailable";

export function deriveVehicleBadge(vehicle: {
  listingState: string;
  isForSale: boolean;
  saleStatus: string | null;
  isForRent: boolean;
  rentalStatus: string | null;
}): VehicleBadge {
  if (vehicle.listingState === "archived") return "archived";
  if (vehicle.listingState === "draft") return "draft";
  const saleAvailable = vehicle.isForSale && vehicle.saleStatus === "available";
  const rentalAvailable =
    vehicle.isForRent && vehicle.rentalStatus === "available";
  if (vehicle.isForSale && vehicle.saleStatus === "sold" && !rentalAvailable)
    return "sold";
  if (vehicle.isForRent && vehicle.rentalStatus === "rented" && !saleAvailable)
    return "rented";
  if (
    vehicle.isForSale &&
    vehicle.saleStatus === "reserved" &&
    !rentalAvailable
  )
    return "reserved";
  if (
    vehicle.isForRent &&
    vehicle.rentalStatus === "reserved" &&
    !saleAvailable
  )
    return "reserved";
  if (saleAvailable && rentalAvailable) return "sale-and-rent";
  if (saleAvailable) return "for-sale";
  if (rentalAvailable) return "for-rent";
  return "unavailable";
}

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
  readonly isForSale: boolean;
  readonly saleStatus: string | null;
  readonly salePrice: number | null;
  readonly isForRent: boolean;
  readonly rentalStatus: string | null;
  readonly rentalDailyPrice: number | null;
  readonly minRentalDays: number | null;
  readonly location: string | null;
  readonly isFeatured: boolean;
  readonly coverImage: VehicleImageDTO | null;
}

export interface VehiclePublicDetailDTO extends VehicleCardDTO {
  readonly bodyType: string;
  readonly condition: string;
  readonly transmission: string;
  readonly fuelType: string;
  readonly driverOption: string;
  readonly driverNote: string | null;
  readonly isNegotiable: boolean;
  readonly mileageKm: number | null;
  readonly engineCc: number | null;
  readonly engineDescription: string | null;
  readonly seats: number | null;
  readonly doors: number | null;
  readonly exteriorColor: string | null;
  readonly interiorColor: string | null;
  readonly drivetrain: string | null;
  readonly features: readonly string[];
  readonly description: string | null;
  readonly images: readonly VehicleImageDTO[];
}

export interface VehicleAdminDTO extends VehiclePublicDetailDTO {
  readonly brandId: string;
  readonly registrationNumber: string | null;
  readonly chassisNumber: string | null;
  readonly listingState: string;
  readonly badge: VehicleBadge;
  readonly featuredAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publicationReadiness: PublicationReadiness;
}

function mapImage(
  image: VehiclePublicRecord["images"][number],
): VehicleImageDTO {
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

function validText(value: string | null | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

export function getPublicationReadiness(vehicle: {
  brandName: string;
  model: string;
  year: number;
  bodyType: string;
  condition: string;
  transmission: string;
  fuelType: string;
  drivetrain?: string | null;
  location?: string | null;
  description: string | null;
  images: readonly { isCover: boolean; altText: string | null }[];
  isForSale: boolean;
  saleStatus: string | null;
  salePrice: bigint | null;
  isForRent?: boolean;
  rentalStatus?: string | null;
  rentalDailyPrice?: bigint | null;
  minRentalDays?: number | null;
  mileageKm?: number | null;
  driverOption: string;
  driverNote?: string | null;
  exteriorColor?: string | null;
  seats?: number | null;
}): PublicationReadiness {
  const state: Record<PublicationRequirement, boolean> = {
    brand: validText(vehicle.brandName),
    model: validText(vehicle.model),
    year:
      Number.isInteger(vehicle.year) &&
      vehicle.year >= 1980 &&
      vehicle.year <= 2100,
    bodyType: validText(vehicle.bodyType),
    condition: validText(vehicle.condition),
    transmission: validText(vehicle.transmission),
    fuelType: validText(vehicle.fuelType),
    drivetrain: validText(vehicle.drivetrain),
    location: validText(vehicle.location),
    description: (vehicle.description?.trim().length ?? 0) >= 40,
    image: vehicle.images.length > 0,
    coverImage: vehicle.images.filter((image) => image.isCover).length === 1,
    imageAltText:
      vehicle.images.length > 0 &&
      vehicle.images.every((image) => validText(image.altText)),
    commercialMode: vehicle.isForSale || vehicle.isForRent === true,
    saleStatus: !vehicle.isForSale || vehicle.saleStatus !== null,
    salePrice:
      !vehicle.isForSale ||
      (vehicle.salePrice !== null && vehicle.salePrice > BigInt(0)),
    rentalStatus: !vehicle.isForRent || vehicle.rentalStatus != null,
    rentalDailyPrice:
      !vehicle.isForRent ||
      (vehicle.rentalDailyPrice != null &&
        vehicle.rentalDailyPrice > BigInt(0)),
    minRentalDays:
      !vehicle.isForRent ||
      (vehicle.minRentalDays != null &&
        vehicle.minRentalDays >= 1 &&
        vehicle.minRentalDays <= 365),
    mileageKm: vehicle.condition === "brand_new" || vehicle.mileageKm != null,
    driverNote:
      vehicle.driverOption !== "with_driver" || validText(vehicle.driverNote),
    exteriorColor: validText(vehicle.exteriorColor),
    seats: vehicle.seats != null,
  };
  const checklist = (
    Object.keys(PUBLICATION_REQUIREMENTS) as PublicationRequirement[]
  ).map((key) => ({
    key,
    label: PUBLICATION_REQUIREMENTS[key],
    met: state[key],
  }));
  const missing = checklist.filter((item) => !item.met).map((item) => item.key);
  return { ready: missing.length === 0, missing, checklist };
}

/** Compatibility name retained for Phase 4 callers. */
export function publicationRequirements(
  vehicle: Parameters<typeof getPublicationReadiness>[0],
): readonly PublicationRequirement[] {
  return getPublicationReadiness(vehicle).missing;
}

function publicFields(vehicle: VehiclePublicRecord): VehiclePublicDetailDTO {
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
    driverNote: vehicle.driverNote ?? null,
    isForSale: vehicle.isForSale,
    saleStatus: vehicle.saleStatus,
    salePrice:
      vehicle.salePrice === null ? null : toShillings(vehicle.salePrice),
    isForRent: vehicle.isForRent ?? false,
    rentalStatus: vehicle.rentalStatus ?? null,
    rentalDailyPrice:
      vehicle.rentalDailyPrice == null
        ? null
        : toShillings(vehicle.rentalDailyPrice),
    minRentalDays: vehicle.minRentalDays ?? null,
    isNegotiable: vehicle.isNegotiable ?? false,
    location: vehicle.location ?? null,
    mileageKm: vehicle.mileageKm ?? null,
    engineCc: vehicle.engineCc ?? null,
    engineDescription: vehicle.engineDescription ?? null,
    seats: vehicle.seats ?? null,
    doors: vehicle.doors ?? null,
    exteriorColor: vehicle.exteriorColor ?? null,
    interiorColor: vehicle.interiorColor ?? null,
    drivetrain: vehicle.drivetrain ?? null,
    features: [...(vehicle.features ?? [])],
    isFeatured: vehicle.isFeatured ?? false,
    description: vehicle.description,
    coverImage: images.find((image) => image.isCover) ?? null,
    images,
  };
}

export function toVehicleCardDTO(vehicle: VehiclePublicRecord): VehicleCardDTO {
  const value = publicFields(vehicle);
  return {
    id: value.id,
    slug: value.slug,
    brandName: value.brandName,
    model: value.model,
    year: value.year,
    isForSale: value.isForSale,
    saleStatus: value.saleStatus,
    salePrice: value.salePrice,
    isForRent: value.isForRent,
    rentalStatus: value.rentalStatus,
    rentalDailyPrice: value.rentalDailyPrice,
    minRentalDays: value.minRentalDays,
    location: value.location,
    isFeatured: value.isFeatured,
    coverImage: value.coverImage,
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
  return {
    ...publicFields(vehicle),
    brandId: vehicle.brandId,
    registrationNumber: vehicle.registrationNumber ?? null,
    chassisNumber: vehicle.chassisNumber ?? null,
    listingState: vehicle.listingState,
    badge: deriveVehicleBadge({
      listingState: vehicle.listingState,
      isForSale: vehicle.isForSale,
      saleStatus: vehicle.saleStatus,
      isForRent: vehicle.isForRent ?? false,
      rentalStatus: vehicle.rentalStatus ?? null,
    }),
    featuredAt: vehicle.featuredAt?.toISOString() ?? null,
    lastVerifiedAt: vehicle.lastVerifiedAt?.toISOString() ?? null,
    publishedAt: vehicle.publishedAt?.toISOString() ?? null,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    publicationReadiness: getPublicationReadiness(vehicle),
  };
}
