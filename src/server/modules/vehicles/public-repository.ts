import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ListingState,
  RentalStatus,
  SaleStatus,
} from "@/generated/prisma/enums";
import type { BodyTypeValue } from "@/lib/vehicle-values";
import { VEHICLE_IMAGE_SELECT } from "@/server/modules/vehicles/repository";

/**
 * Read-only public catalogue repository (Phase 6).
 *
 * Separate from the admin {@link VehicleRepository} so the public read surface
 * uses its own explicit, minimal selects and its own query semantics without
 * entangling the administrative write model. Every select is explicit and
 * excludes registration/chassis numbers, private timestamps, audit data,
 * notification recipients, updater identity, and any relation beyond the safe
 * public image projection.
 */

/** Card select: only the fields a catalogue card renders (cover image only). */
export const VEHICLE_PUBLIC_CARD_SELECT = {
  id: true,
  slug: true,
  brandName: true,
  model: true,
  year: true,
  listingState: true,
  driverOption: true,
  isForSale: true,
  saleStatus: true,
  salePrice: true,
  isForRent: true,
  rentalStatus: true,
  rentalDailyPrice: true,
  minRentalDays: true,
  location: true,
  isFeatured: true,
  images: {
    select: VEHICLE_IMAGE_SELECT,
    where: { isCover: true },
    take: 1,
  },
} as const satisfies Prisma.VehicleSelect;

/** Detail select: the approved public specification surface plus all images. */
export const VEHICLE_PUBLIC_DETAIL_SELECT = {
  id: true,
  slug: true,
  brandName: true,
  model: true,
  year: true,
  listingState: true,
  bodyType: true,
  condition: true,
  transmission: true,
  fuelType: true,
  driverOption: true,
  driverNote: true,
  isForSale: true,
  saleStatus: true,
  salePrice: true,
  isNegotiable: true,
  isForRent: true,
  rentalStatus: true,
  rentalDailyPrice: true,
  minRentalDays: true,
  location: true,
  mileageKm: true,
  engineCc: true,
  engineDescription: true,
  seats: true,
  doors: true,
  exteriorColor: true,
  interiorColor: true,
  drivetrain: true,
  features: true,
  isFeatured: true,
  description: true,
  images: {
    select: VEHICLE_IMAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.VehicleSelect;

export type VehiclePublicCardRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_CARD_SELECT;
}>;
export type VehiclePublicDetailRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_DETAIL_SELECT;
}>;

/** Fixed limits for the home strips, featured rail, and related rail. */
export const FEATURED_LIMIT = 8;
export const STRIP_LIMIT = 4;
export const RELATED_LIMIT = 4;

export interface PublicCataloguePageInput {
  readonly page: number;
  readonly pageSize: number;
}
export interface PublicCataloguePageRecord {
  readonly items: readonly VehiclePublicCardRecord[];
  readonly total: number;
}
export interface RelatedVehiclesInput {
  readonly vehicleId: string;
  readonly brandName: string;
  readonly bodyType: BodyTypeValue;
  readonly limit: number;
}

export interface PublicVehicleRepository {
  listActiveCatalogue(
    input: PublicCataloguePageInput,
  ): Promise<PublicCataloguePageRecord>;
  listSaleCatalogue(
    input: PublicCataloguePageInput,
  ): Promise<PublicCataloguePageRecord>;
  listRentalCatalogue(
    input: PublicCataloguePageInput,
  ): Promise<PublicCataloguePageRecord>;
  listFeatured(): Promise<readonly VehiclePublicCardRecord[]>;
  listSaleStrip(): Promise<readonly VehiclePublicCardRecord[]>;
  listRentalStrip(): Promise<readonly VehiclePublicCardRecord[]>;
  getDetailBySlug(slug: string): Promise<VehiclePublicDetailRecord | null>;
  listRelated(
    input: RelatedVehiclesInput,
  ): Promise<readonly VehiclePublicCardRecord[]>;
}

export type PublicVehiclePrismaClient = Pick<PrismaClient, "vehicle">;

// ── Shared, single-source-of-truth WHERE fragments ───────────────────────────

/** Sale mode is currently usable: enabled, available/reserved, positive price. */
const saleUsableWhere: Prisma.VehicleWhereInput = {
  isForSale: true,
  saleStatus: { in: [SaleStatus.available, SaleStatus.reserved] },
  salePrice: { gt: BigInt(0) },
};

/** Rental mode is currently usable: enabled, available/reserved, valid pricing. */
const rentalUsableWhere: Prisma.VehicleWhereInput = {
  isForRent: true,
  rentalStatus: { in: [RentalStatus.available, RentalStatus.reserved] },
  rentalDailyPrice: { gt: BigInt(0) },
  minRentalDays: { gte: 1 },
};

/** A published vehicle with at least one currently usable commercial mode. */
const activeWhere: Prisma.VehicleWhereInput = {
  listingState: ListingState.published,
  OR: [saleUsableWhere, rentalUsableWhere],
};

const saleCatalogueWhere: Prisma.VehicleWhereInput = {
  listingState: ListingState.published,
  ...saleUsableWhere,
};

const rentalCatalogueWhere: Prisma.VehicleWhereInput = {
  listingState: ListingState.published,
  ...rentalUsableWhere,
};

/** Stable newest-first ordering with a deterministic ID tie-break. */
const NEWEST_FIRST: Prisma.VehicleOrderByWithRelationInput[] = [
  { publishedAt: "desc" },
  { id: "asc" },
];

export function createPrismaPublicVehicleRepository(
  client: PublicVehiclePrismaClient,
): PublicVehicleRepository {
  async function page(
    where: Prisma.VehicleWhereInput,
    input: PublicCataloguePageInput,
  ): Promise<PublicCataloguePageRecord> {
    const [items, total] = await Promise.all([
      client.vehicle.findMany({
        where,
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: NEWEST_FIRST,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      client.vehicle.count({ where }),
    ]);
    return { items, total };
  }

  return {
    listActiveCatalogue(input) {
      return page(activeWhere, input);
    },
    listSaleCatalogue(input) {
      return page(saleCatalogueWhere, input);
    },
    listRentalCatalogue(input) {
      return page(rentalCatalogueWhere, input);
    },
    async listFeatured() {
      return client.vehicle.findMany({
        where: {
          listingState: ListingState.published,
          isFeatured: true,
          OR: [saleUsableWhere, rentalUsableWhere],
        },
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: [{ featuredAt: "desc" }, { id: "asc" }],
        take: FEATURED_LIMIT,
      });
    },
    async listSaleStrip() {
      return client.vehicle.findMany({
        where: saleCatalogueWhere,
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: NEWEST_FIRST,
        take: STRIP_LIMIT,
      });
    },
    async listRentalStrip() {
      return client.vehicle.findMany({
        where: rentalCatalogueWhere,
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: NEWEST_FIRST,
        take: STRIP_LIMIT,
      });
    },
    async getDetailBySlug(slug) {
      // Published OR archived resolve by direct slug (draft never does). The
      // presentation state resolver classifies the result downstream.
      return client.vehicle.findFirst({
        where: {
          slug,
          listingState: {
            in: [ListingState.published, ListingState.archived],
          },
        },
        select: VEHICLE_PUBLIC_DETAIL_SELECT,
      });
    },
    async listRelated({ vehicleId, brandName, bodyType, limit }) {
      const usable: Prisma.VehicleWhereInput = {
        OR: [saleUsableWhere, rentalUsableWhere],
      };
      const preferred = await client.vehicle.findMany({
        where: {
          AND: [
            { listingState: ListingState.published },
            { id: { not: vehicleId } },
            usable,
            { OR: [{ brandName }, { bodyType }] },
          ],
        },
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: NEWEST_FIRST,
        take: limit,
      });
      if (preferred.length >= limit) return preferred.slice(0, limit);

      const excludeIds = [vehicleId, ...preferred.map((v) => v.id)];
      const fill = await client.vehicle.findMany({
        where: {
          AND: [
            { listingState: ListingState.published },
            { id: { notIn: excludeIds } },
            usable,
          ],
        },
        select: VEHICLE_PUBLIC_CARD_SELECT,
        orderBy: NEWEST_FIRST,
        take: limit - preferred.length,
      });
      return [...preferred, ...fill];
    },
  };
}
