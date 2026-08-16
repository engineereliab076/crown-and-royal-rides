import "server-only";

import { toShillings } from "@/lib/money";
import { buildPaginatedResult, PUBLIC_PAGE_SIZE } from "@/lib/pagination";
import { toAppliedFilters } from "@/lib/vehicle-filters";
import type { BodyTypeValue } from "@/lib/vehicle-values";
import { resolveVehiclePublicState } from "@/lib/vehicle-public-state";
import { AppError } from "@/server/http/errors";
import {
  resolveDetailRecordPresentation,
  toPublicVehicleCard,
  toPublicVehicleDetail,
  toRelatedVehicle,
  toVehicleFacets,
  type NormalizedCatalogueQuery,
  type NormalizedCatalogueResult,
  type PublicVehicleCard,
  type PublicVehicleDetailResult,
  type PublicVehiclePage,
} from "@/server/modules/vehicles/public-dto";
import {
  RELATED_LIMIT,
  type PublicCataloguePageInput,
  type PublicCataloguePageRecord,
  type PublicVehicleRepository,
} from "@/server/modules/vehicles/public-repository";
import { vehicleSlugSchema } from "@/server/modules/vehicles/schemas";

/**
 * Public catalogue read service (Phase 6).
 *
 * The single boundary the public pages call for catalogue data and detail
 * resolution. All state classification, price conversion, and pagination shape
 * are centralized here and in the DTO/resolver so no page or component queries
 * Prisma or re-derives business rules.
 */
export interface PublicVehicleCatalogueService {
  listActiveCatalogue(page: number): Promise<PublicVehiclePage>;
  listSaleCatalogue(page: number): Promise<PublicVehiclePage>;
  listRentalCatalogue(page: number): Promise<PublicVehiclePage>;
  listFeatured(): Promise<readonly PublicVehicleCard[]>;
  listSaleStrip(): Promise<readonly PublicVehicleCard[]>;
  listRentalStrip(): Promise<readonly PublicVehicleCard[]>;
  /**
   * Resolve a `/cars/[slug]` detail. Distinguishes missing/draft (404) from
   * archived (retired) and sold sale-only (historical); returns the safe
   * detail, its centralized presentation state, related available vehicles,
   * and the robots directive.
   */
  getPublicDetail(slug: string): Promise<PublicVehicleDetailResult>;
  /**
   * Execute a normalized catalogue search: cards, 24-per-page pagination,
   * accepted filters, chosen sort, and facets. The result is fully determined
   * by the normalized query and carries no request-specific ignored-filter
   * report, so it is safe to store in the shared data cache.
   */
  executeCatalogueSearch(
    query: NormalizedCatalogueQuery,
  ): Promise<NormalizedCatalogueResult>;
  listIndexableSlugs(): Promise<readonly string[]>;
}

function notFound(): AppError {
  return new AppError({
    status: 404,
    code: "VEHICLE_NOT_FOUND",
    message: "Vehicle not found.",
  });
}

function normalizePage(page: number): number {
  return Number.isFinite(page) && page >= 1 ? Math.trunc(page) : 1;
}

export function createPublicVehicleService(input: {
  readonly repository: PublicVehicleRepository;
}): PublicVehicleCatalogueService {
  const { repository } = input;

  async function pageOf(
    load: (
      args: PublicCataloguePageInput,
    ) => Promise<PublicCataloguePageRecord>,
    rawPage: number,
  ): Promise<PublicVehiclePage> {
    const page = normalizePage(rawPage);
    const record = await load({ page, pageSize: PUBLIC_PAGE_SIZE });
    return buildPaginatedResult({
      items: record.items.map(toPublicVehicleCard),
      page,
      totalItems: record.total,
      pageSize: PUBLIC_PAGE_SIZE,
    });
  }

  return {
    listActiveCatalogue(page) {
      return pageOf((args) => repository.listActiveCatalogue(args), page);
    },
    listSaleCatalogue(page) {
      return pageOf((args) => repository.listSaleCatalogue(args), page);
    },
    listRentalCatalogue(page) {
      return pageOf((args) => repository.listRentalCatalogue(args), page);
    },
    async listFeatured() {
      return (await repository.listFeatured()).map(toPublicVehicleCard);
    },
    async listSaleStrip() {
      return (await repository.listSaleStrip()).map(toPublicVehicleCard);
    },
    async listRentalStrip() {
      return (await repository.listRentalStrip()).map(toPublicVehicleCard);
    },
    async getPublicDetail(rawSlug) {
      const slug = vehicleSlugSchema.safeParse(rawSlug);
      if (!slug.success) throw notFound();
      const record = await repository.getDetailBySlug(slug.data);
      if (record === null) throw notFound();
      const presentation = resolveDetailRecordPresentation(record);
      const related = (
        await repository.listRelated({
          vehicleId: record.id,
          brandName: record.brandName,
          bodyType: record.bodyType as BodyTypeValue,
          limit: RELATED_LIMIT,
        })
      ).map(toRelatedVehicle);
      return {
        vehicle: toPublicVehicleDetail(record),
        presentation,
        related,
        robots: presentation.robots,
      };
    },
    async executeCatalogueSearch(query) {
      const page = normalizePage(query.page);
      const [record, rawFacets] = await Promise.all([
        repository.searchVehicles({
          mode: query.mode,
          filters: query.filters,
          sort: query.sort,
          page,
          pageSize: PUBLIC_PAGE_SIZE,
        }),
        repository.getVehicleFacets({
          mode: query.mode,
          filters: query.filters,
        }),
      ]);
      const paginated = buildPaginatedResult({
        items: record.items.map(toPublicVehicleCard),
        page,
        totalItems: record.total,
        pageSize: PUBLIC_PAGE_SIZE,
      });
      return {
        ...paginated,
        appliedFilters: toAppliedFilters(query.filters),
        sort: query.sort,
        facets: toVehicleFacets(rawFacets, query.filters),
      };
    },
    async listIndexableSlugs() {
      const candidates = await repository.listSitemapCandidates();
      return candidates.flatMap((candidate) => {
        const presentation = resolveVehiclePublicState({
          listingState: candidate.listingState,
          isForSale: candidate.isForSale,
          saleStatus: candidate.saleStatus,
          salePrice:
            candidate.salePrice === null
              ? null
              : toShillings(candidate.salePrice),
          isForRent: candidate.isForRent,
          rentalStatus: candidate.rentalStatus,
          rentalDailyPrice:
            candidate.rentalDailyPrice === null
              ? null
              : toShillings(candidate.rentalDailyPrice),
          minRentalDays: candidate.minRentalDays,
        });
        return presentation.indexable ? [candidate.slug] : [];
      });
    },
  };
}
