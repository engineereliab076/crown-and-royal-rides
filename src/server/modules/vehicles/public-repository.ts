import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  ListingState,
  RentalStatus,
  SaleStatus,
} from "@/generated/prisma/enums";
import type {
  NormalizedVehicleFilters,
  VehicleMode,
  VehicleSort,
} from "@/lib/vehicle-filters";
import type { BodyTypeValue } from "@/lib/vehicle-values";
import { VEHICLE_IMAGE_SELECT } from "@/server/modules/vehicles/repository";
import {
  composeWhereSql,
  fromClauseSql,
  modePredicateSql,
  orderBySql,
} from "@/server/modules/vehicles/search-sql";

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

/** Minimal publication-state projection used only by sitemap eligibility. */
export const VEHICLE_SITEMAP_SELECT = {
  slug: true,
  listingState: true,
  isForSale: true,
  saleStatus: true,
  salePrice: true,
  isForRent: true,
  rentalStatus: true,
  rentalDailyPrice: true,
  minRentalDays: true,
} as const satisfies Prisma.VehicleSelect;

export type VehiclePublicCardRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_CARD_SELECT;
}>;
export type VehiclePublicDetailRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_DETAIL_SELECT;
}>;
export type VehicleSitemapRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_SITEMAP_SELECT;
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

/** The normalized inputs for a catalogue search (Phase 7). */
export interface VehicleSearchInput {
  readonly mode: VehicleMode;
  readonly filters: NormalizedVehicleFilters;
  readonly sort: VehicleSort;
  readonly page: number;
  readonly pageSize: number;
}

/** A single categorical facet bucket, before ordering/labelling. */
export interface RawFacetCount {
  readonly value: string;
  readonly count: number;
}
export interface RawBrandFacetCount {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}
export interface NumericRange {
  readonly min: number;
  readonly max: number;
}

/** Raw, unordered facet counts straight from the database. */
export interface RawVehicleFacets {
  readonly brand: readonly RawBrandFacetCount[];
  readonly bodyType: readonly RawFacetCount[];
  readonly condition: readonly RawFacetCount[];
  readonly transmission: readonly RawFacetCount[];
  readonly fuelType: readonly RawFacetCount[];
  readonly drivetrain: readonly RawFacetCount[];
  readonly driverOption: readonly RawFacetCount[];
  readonly year: NumericRange | null;
  readonly price: NumericRange | null;
}

export interface VehicleFacetsInput {
  readonly mode: VehicleMode;
  readonly filters: NormalizedVehicleFilters;
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
  /** URL-driven catalogue search: filters, sort, and 24-per-page pagination. */
  searchVehicles(input: VehicleSearchInput): Promise<PublicCataloguePageRecord>;
  /** Self-excluded categorical facet counts plus mode-wide numeric ranges. */
  getVehicleFacets(input: VehicleFacetsInput): Promise<RawVehicleFacets>;
  /** Minimal candidates; final indexability is resolved in the service. */
  listSitemapCandidates(): Promise<readonly VehicleSitemapRecord[]>;
}

export type PublicVehiclePrismaClient = Pick<
  PrismaClient,
  "vehicle" | "$queryRaw"
>;

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
    async listSitemapCandidates() {
      return client.vehicle.findMany({
        where: { listingState: ListingState.published },
        select: VEHICLE_SITEMAP_SELECT,
        orderBy: [{ publishedAt: "desc" }, { slug: "asc" }],
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

    async searchVehicles({ mode, filters, sort, page, pageSize }) {
      // 1. A parameterized raw query selects only ordered vehicle IDs (plus the
      //    internal rank needed for ordering, which never leaves this method).
      const from = fromClauseSql(filters.q);
      const where = composeWhereSql(mode, filters, { includeSearch: true });
      const orderBy = orderBySql(mode, sort, filters.q);
      const offset = (page - 1) * pageSize;

      const [idRows, countRows] = await Promise.all([
        client.$queryRaw<readonly { id: string }[]>(
          Prisma.sql`SELECT v.id ${from} WHERE ${where} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
        ),
        client.$queryRaw<readonly { count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count ${from} WHERE ${where}`,
        ),
      ]);
      const total = toCount(countRows[0]?.count);
      const ids = idRows.map((row) => row.id);
      if (ids.length === 0) return { items: [], total };

      // 2. Hydrate the ordered IDs through the existing explicit public select.
      const rows = await client.vehicle.findMany({
        where: { id: { in: ids } },
        select: VEHICLE_PUBLIC_CARD_SELECT,
      });
      // 3. Reorder hydrated rows to match the ranked ID order.
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [row];
      });
      return { items, total };
    },

    async getVehicleFacets({ mode, filters }) {
      // The tsquery alias is cross-joined only when a search term is present.
      const tsqueryJoin =
        filters.q === null
          ? Prisma.empty
          : Prisma.sql`, websearch_to_tsquery('english', ${filters.q}) query`;
      const catalogueFrom = Prisma.sql`FROM vehicles v${tsqueryJoin}`;
      const brandFrom = Prisma.sql`FROM vehicles v JOIN brands b ON b.id = v.brand_id${tsqueryJoin}`;

      // Categorical counts are self-excluded: every current filter except the
      // facet's own dimension, with the search term always applied.
      const brandWhere = composeWhereSql(mode, filters, {
        exclude: "brand",
        includeSearch: true,
      });
      const bodyTypeWhere = composeWhereSql(mode, filters, {
        exclude: "bodyType",
        includeSearch: true,
      });
      const conditionWhere = composeWhereSql(mode, filters, {
        exclude: "condition",
        includeSearch: true,
      });
      const transmissionWhere = composeWhereSql(mode, filters, {
        exclude: "transmission",
        includeSearch: true,
      });
      const fuelTypeWhere = composeWhereSql(mode, filters, {
        exclude: "fuelType",
        includeSearch: true,
      });
      const drivetrainWhere = composeWhereSql(mode, filters, {
        exclude: "drivetrain",
        includeSearch: true,
      });
      const driverOptionWhere = composeWhereSql(mode, filters, {
        exclude: "driverOption",
        includeSearch: true,
      });

      // Numeric ranges are mode-wide and stable: the base catalogue predicate
      // only — not filter-aware and not search-aware.
      const rangePredicate = modePredicateSql(mode);
      const rangeSelect =
        mode === "sale"
          ? Prisma.sql`SELECT MIN(v.year) AS year_min, MAX(v.year) AS year_max, MIN(v.sale_price) AS price_min, MAX(v.sale_price) AS price_max`
          : mode === "rental"
            ? Prisma.sql`SELECT MIN(v.year) AS year_min, MAX(v.year) AS year_max, MIN(v.rental_daily_price) AS price_min, MAX(v.rental_daily_price) AS price_max`
            : Prisma.sql`SELECT MIN(v.year) AS year_min, MAX(v.year) AS year_max, NULL::bigint AS price_min, NULL::bigint AS price_max`;

      // Eight bounded queries: seven categorical group-bys plus one range query.
      // Any failure rejects the whole call so incorrect counts are never served.
      const [
        brandRows,
        bodyTypeRows,
        conditionRows,
        transmissionRows,
        fuelTypeRows,
        drivetrainRows,
        driverOptionRows,
        rangeRows,
      ] = await Promise.all([
        client.$queryRaw<readonly RawBrandRow[]>(
          Prisma.sql`SELECT b.slug AS value, b.name AS label, COUNT(*) AS count ${brandFrom} WHERE ${brandWhere} GROUP BY b.slug, b.name`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.body_type::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${bodyTypeWhere} GROUP BY v.body_type`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.condition::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${conditionWhere} GROUP BY v.condition`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.transmission::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${transmissionWhere} GROUP BY v.transmission`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.fuel_type::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${fuelTypeWhere} GROUP BY v.fuel_type`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.drivetrain::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${drivetrainWhere} AND v.drivetrain IS NOT NULL GROUP BY v.drivetrain`,
        ),
        client.$queryRaw<readonly RawCountRow[]>(
          Prisma.sql`SELECT v.driver_option::text AS value, COUNT(*) AS count ${catalogueFrom} WHERE ${driverOptionWhere} GROUP BY v.driver_option`,
        ),
        client.$queryRaw<readonly RawRangeRow[]>(
          Prisma.sql`${rangeSelect} FROM vehicles v WHERE ${rangePredicate}`,
        ),
      ]);

      const range = rangeRows[0];
      const year = toRange(range?.year_min, range?.year_max);
      const price = toRange(range?.price_min, range?.price_max);

      return {
        brand: brandRows.map((row) => ({
          value: row.value,
          label: row.label,
          count: toCount(row.count),
        })),
        bodyType: mapCounts(bodyTypeRows),
        condition: mapCounts(conditionRows),
        transmission: mapCounts(transmissionRows),
        fuelType: mapCounts(fuelTypeRows),
        drivetrain: mapCounts(drivetrainRows),
        driverOption: mapCounts(driverOptionRows),
        year,
        price,
      };
    },
  };
}

interface RawCountRow {
  readonly value: string;
  readonly count: bigint;
}
interface RawBrandRow {
  readonly value: string;
  readonly label: string;
  readonly count: bigint;
}
interface RawRangeRow {
  readonly year_min: number | bigint | null;
  readonly year_max: number | bigint | null;
  readonly price_min: number | bigint | null;
  readonly price_max: number | bigint | null;
}

function toCount(value: bigint | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return Number(value);
}

function mapCounts(rows: readonly RawCountRow[]): RawFacetCount[] {
  return rows.map((row) => ({ value: row.value, count: toCount(row.count) }));
}

function toRange(
  min: number | bigint | null | undefined,
  max: number | bigint | null | undefined,
): NumericRange | null {
  if (min === null || min === undefined || max === null || max === undefined) {
    return null;
  }
  return { min: Number(min), max: Number(max) };
}
