import "server-only";

import { toShillings } from "@/lib/money";
import type { PaginatedResult } from "@/lib/pagination";
import type {
  AppliedFilters,
  IgnoredFilter,
  NormalizedVehicleFilters,
  VehicleBrandFacetOption,
  VehicleFacetOption,
  VehicleFacets,
  VehicleMode,
  VehicleSort,
} from "@/lib/vehicle-filters";
import {
  resolveVehiclePublicState,
  type RobotsDirective,
  type VehiclePublicState,
} from "@/lib/vehicle-public-state";
import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  DRIVETRAINS,
  FUEL_TYPES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";
import type {
  RawFacetCount,
  RawVehicleFacets,
  VehiclePublicCardRecord,
  VehiclePublicDetailRecord,
} from "@/server/modules/vehicles/public-repository";

/**
 * Safe public catalogue DTOs (Phase 6).
 *
 * Every price is converted from a database `bigint` to a checked JavaScript
 * `number` (or `null`), so the whole DTO is JSON-serializable and never throws
 * in `JSON.stringify`. Every image carries a guaranteed non-empty `altText`.
 * Private identifiers are absent at the type, select, mapper, and serialization
 * levels. Each DTO also carries the centralized {@link VehiclePublicState} so
 * pages and components never re-derive the business rules.
 */

/** A safe delivery-only public image; `altText` is always non-empty. */
export interface VehiclePublicImageDTO {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string;
  readonly isCover: boolean;
  readonly sortOrder: number;
}

/** A catalogue card. Contains only the fields a card renders. */
export interface PublicVehicleCard {
  readonly id: string;
  readonly slug: string;
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
  readonly driverOption: string;
  readonly isForSale: boolean;
  readonly saleStatus: string | null;
  readonly salePrice: number | null;
  readonly isForRent: boolean;
  readonly rentalStatus: string | null;
  readonly rentalDailyPrice: number | null;
  readonly minRentalDays: number | null;
  readonly location: string | null;
  readonly isFeatured: boolean;
  readonly coverImage: VehiclePublicImageDTO | null;
  readonly presentation: VehiclePublicState;
}

/** A related-vehicle entry reuses the card shape and rendering. */
export type RelatedVehicle = PublicVehicleCard;

/** The full public detail surface (approved public specifications only). */
export interface PublicVehicleDetail {
  readonly id: string;
  readonly slug: string;
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
  readonly bodyType: string;
  readonly condition: string;
  readonly transmission: string;
  readonly fuelType: string;
  readonly driverOption: string;
  readonly driverNote: string | null;
  readonly isForSale: boolean;
  readonly saleStatus: string | null;
  readonly salePrice: number | null;
  readonly isNegotiable: boolean;
  readonly isForRent: boolean;
  readonly rentalStatus: string | null;
  readonly rentalDailyPrice: number | null;
  readonly minRentalDays: number | null;
  readonly location: string | null;
  readonly mileageKm: number | null;
  readonly engineCc: number | null;
  readonly engineDescription: string | null;
  readonly seats: number | null;
  readonly doors: number | null;
  readonly exteriorColor: string | null;
  readonly interiorColor: string | null;
  readonly drivetrain: string | null;
  readonly features: readonly string[];
  readonly isFeatured: boolean;
  readonly description: string | null;
  readonly coverImage: VehiclePublicImageDTO | null;
  readonly images: readonly VehiclePublicImageDTO[];
}

/** The single resolved result the `/cars/[slug]` service returns. */
export interface PublicVehicleDetailResult {
  readonly vehicle: PublicVehicleDetail;
  readonly presentation: VehiclePublicState;
  readonly related: readonly RelatedVehicle[];
  readonly robots: RobotsDirective;
}

/** A paginated page of catalogue cards. */
export type PublicVehiclePage = PaginatedResult<PublicVehicleCard>;

/** The normalized catalogue query the cacheable execution consumes. */
export interface NormalizedCatalogueQuery {
  readonly mode: VehicleMode;
  readonly filters: NormalizedVehicleFilters;
  readonly sort: VehicleSort;
  readonly page: number;
}

/**
 * The cacheable portion of a catalogue search: fully determined by the
 * normalized query. Deliberately excludes request-specific `ignoredFilters` so
 * it never leaks or collides through the shared data cache.
 */
export interface NormalizedCatalogueResult {
  readonly items: readonly PublicVehicleCard[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
  readonly appliedFilters: AppliedFilters;
  readonly sort: VehicleSort;
  readonly facets: VehicleFacets;
}

/** The full public search result: cacheable data plus request-scoped meta. */
export interface VehicleCatalogueSearchResult extends NormalizedCatalogueResult {
  readonly meta: {
    readonly ignoredFilters: readonly IgnoredFilter[];
  };
}

/** Merge request-scoped ignored-filter reporting onto a cached result. Pure. */
export function attachIgnoredFilters(
  result: NormalizedCatalogueResult,
  ignoredFilters: readonly IgnoredFilter[],
): VehicleCatalogueSearchResult {
  return { ...result, meta: { ignoredFilters } };
}

function orderEnumFacet(
  order: readonly string[],
  rows: readonly RawFacetCount[],
  selected: string | null,
): VehicleFacetOption[] {
  const counts = new Map(rows.map((row) => [row.value, row.count]));
  const options: VehicleFacetOption[] = [];
  for (const value of order) {
    const count = counts.get(value) ?? 0;
    // Omit zero-count entries unless they are the currently selected value,
    // which must remain representable so the UI can render/clear it.
    if (count > 0 || value === selected) options.push({ value, count });
  }
  return options;
}

function orderBrandFacet(
  rows: readonly VehicleBrandFacetOption[],
  selected: string | null,
): VehicleBrandFacetOption[] {
  const kept = rows.filter((row) => row.count > 0 || row.value === selected);
  if (selected !== null && !kept.some((row) => row.value === selected)) {
    // A selected brand with no qualifying rows is still represented; its label
    // is unknown here, so the slug doubles as a safe fallback label.
    kept.push({ value: selected, label: selected, count: 0 });
  }
  return [...kept].sort(
    (a, b) =>
      b.count - a.count ||
      a.label.localeCompare(b.label) ||
      a.value.localeCompare(b.value),
  );
}

/**
 * Map raw database facet counts to the ordered public facet contract. Enum
 * facets follow the canonical client-safe declaration order; brand facets are
 * ordered by count then label then slug. Numeric ranges pass through unchanged.
 */
export function toVehicleFacets(
  raw: RawVehicleFacets,
  filters: NormalizedVehicleFilters,
): VehicleFacets {
  return {
    brand: orderBrandFacet(raw.brand, filters.brand),
    bodyType: orderEnumFacet(BODY_TYPES, raw.bodyType, filters.bodyType),
    condition: orderEnumFacet(
      VEHICLE_CONDITIONS,
      raw.condition,
      filters.condition,
    ),
    transmission: orderEnumFacet(
      TRANSMISSIONS,
      raw.transmission,
      filters.transmission,
    ),
    fuelType: orderEnumFacet(FUEL_TYPES, raw.fuelType, filters.fuelType),
    drivetrain: orderEnumFacet(DRIVETRAINS, raw.drivetrain, filters.drivetrain),
    driverOption: orderEnumFacet(
      DRIVER_OPTIONS,
      raw.driverOption,
      filters.driverOption,
    ),
    year: raw.year,
    price: raw.price,
  };
}

type ImageRecord = VehiclePublicCardRecord["images"][number];

function fallbackAlt(vehicle: {
  year: number;
  brandName: string;
  model: string;
}): string {
  return `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`;
}

function mapImage(
  image: ImageRecord,
  altFallback: string,
): VehiclePublicImageDTO {
  const trimmed = image.altText?.trim();
  return {
    id: image.id,
    url: image.secureUrl,
    width: image.width,
    height: image.height,
    altText: trimmed && trimmed.length > 0 ? trimmed : altFallback,
    isCover: image.isCover,
    sortOrder: image.sortOrder,
  };
}

function toNumber(value: bigint | null): number | null {
  return value === null ? null : toShillings(value);
}

export function toPublicVehicleCard(
  record: VehiclePublicCardRecord,
): PublicVehicleCard {
  const salePrice = toNumber(record.salePrice);
  const rentalDailyPrice = toNumber(record.rentalDailyPrice);
  const presentation = resolveVehiclePublicState({
    listingState: record.listingState,
    isForSale: record.isForSale,
    saleStatus: record.saleStatus,
    salePrice,
    isForRent: record.isForRent,
    rentalStatus: record.rentalStatus,
    rentalDailyPrice,
    minRentalDays: record.minRentalDays,
  });
  const altFallback = fallbackAlt(record);
  const cover = record.images[0];
  return {
    id: record.id,
    slug: record.slug,
    brandName: record.brandName,
    model: record.model,
    year: record.year,
    driverOption: record.driverOption,
    isForSale: record.isForSale,
    saleStatus: record.saleStatus,
    salePrice,
    isForRent: record.isForRent,
    rentalStatus: record.rentalStatus,
    rentalDailyPrice,
    minRentalDays: record.minRentalDays,
    location: record.location,
    isFeatured: record.isFeatured,
    coverImage: cover ? mapImage(cover, altFallback) : null,
    presentation,
  };
}

export const toRelatedVehicle = toPublicVehicleCard;

export function toPublicVehicleDetail(
  record: VehiclePublicDetailRecord,
): PublicVehicleDetail {
  const altFallback = fallbackAlt(record);
  const images = record.images.map((image) => mapImage(image, altFallback));
  return {
    id: record.id,
    slug: record.slug,
    brandName: record.brandName,
    model: record.model,
    year: record.year,
    bodyType: record.bodyType,
    condition: record.condition,
    transmission: record.transmission,
    fuelType: record.fuelType,
    driverOption: record.driverOption,
    driverNote: record.driverNote,
    isForSale: record.isForSale,
    saleStatus: record.saleStatus,
    salePrice: toNumber(record.salePrice),
    isNegotiable: record.isNegotiable,
    isForRent: record.isForRent,
    rentalStatus: record.rentalStatus,
    rentalDailyPrice: toNumber(record.rentalDailyPrice),
    minRentalDays: record.minRentalDays,
    location: record.location,
    mileageKm: record.mileageKm,
    engineCc: record.engineCc,
    engineDescription: record.engineDescription,
    seats: record.seats,
    doors: record.doors,
    exteriorColor: record.exteriorColor,
    interiorColor: record.interiorColor,
    drivetrain: record.drivetrain,
    features: [...record.features],
    isFeatured: record.isFeatured,
    description: record.description,
    coverImage: images.find((image) => image.isCover) ?? null,
    images,
  };
}

/**
 * Resolve presentation state from the raw detail record, honoring its real
 * listing state so an archived vehicle resolves to `retired` (not `active`).
 */
export function resolveDetailRecordPresentation(
  record: VehiclePublicDetailRecord,
): VehiclePublicState {
  return resolveVehiclePublicState({
    listingState: record.listingState,
    isForSale: record.isForSale,
    saleStatus: record.saleStatus,
    salePrice: toNumber(record.salePrice),
    isForRent: record.isForRent,
    rentalStatus: record.rentalStatus,
    rentalDailyPrice: toNumber(record.rentalDailyPrice),
    minRentalDays: record.minRentalDays,
  });
}
