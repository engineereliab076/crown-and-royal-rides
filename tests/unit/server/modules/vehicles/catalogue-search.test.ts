import { describe, expect, it, vi } from "vitest";

import type { NormalizedVehicleFilters } from "@/lib/vehicle-filters";
import {
  attachIgnoredFilters,
  toVehicleFacets,
  type NormalizedCatalogueResult,
} from "@/server/modules/vehicles/public-dto";
import { createPublicVehicleService } from "@/server/modules/vehicles/public-service";
import type {
  PublicVehicleRepository,
  RawVehicleFacets,
  VehiclePublicCardRecord,
} from "@/server/modules/vehicles/public-repository";

function filters(
  overrides: Partial<NormalizedVehicleFilters> = {},
): NormalizedVehicleFilters {
  return {
    q: null,
    brand: null,
    bodyType: null,
    condition: null,
    transmission: null,
    fuelType: null,
    drivetrain: null,
    driverOption: null,
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    ...overrides,
  };
}

function emptyRawFacets(
  overrides: Partial<RawVehicleFacets> = {},
): RawVehicleFacets {
  return {
    brand: [],
    bodyType: [],
    condition: [],
    transmission: [],
    fuelType: [],
    drivetrain: [],
    driverOption: [],
    year: null,
    price: null,
    ...overrides,
  };
}

function cardRecord(
  overrides: Partial<VehiclePublicCardRecord> = {},
): VehiclePublicCardRecord {
  return {
    id: "card-1",
    slug: "toyota-land-cruiser-2025-abcd",
    brandName: "Toyota",
    model: "Land Cruiser",
    year: 2025,
    listingState: "published",
    driverOption: "without_driver",
    isForSale: true,
    saleStatus: "available",
    salePrice: BigInt(150_000_000),
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    location: "Dar es Salaam",
    isFeatured: false,
    images: [],
    ...overrides,
  } as VehiclePublicCardRecord;
}

function fakeRepository(
  overrides: Partial<PublicVehicleRepository> = {},
): PublicVehicleRepository {
  return {
    listActiveCatalogue: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listSaleCatalogue: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listRentalCatalogue: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listFeatured: vi.fn().mockResolvedValue([]),
    listSaleStrip: vi.fn().mockResolvedValue([]),
    listRentalStrip: vi.fn().mockResolvedValue([]),
    getDetailBySlug: vi.fn().mockResolvedValue(null),
    listRelated: vi.fn().mockResolvedValue([]),
    searchVehicles: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getVehicleFacets: vi.fn().mockResolvedValue(emptyRawFacets()),
    listSitemapCandidates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("toVehicleFacets — ordering and representation", () => {
  it("orders enum facets by canonical declaration order and omits zero counts", () => {
    const raw = emptyRawFacets({
      bodyType: [
        { value: "suv", count: 3 },
        { value: "sedan", count: 1 },
        { value: "coupe", count: 2 },
      ],
    });
    expect(toVehicleFacets(raw, filters()).bodyType).toEqual([
      { value: "sedan", count: 1 },
      { value: "suv", count: 3 },
      { value: "coupe", count: 2 },
    ]);
  });

  it("keeps a zero-count selected enum value represented", () => {
    const raw = emptyRawFacets({ bodyType: [{ value: "sedan", count: 4 }] });
    const facets = toVehicleFacets(raw, filters({ bodyType: "wagon" }));
    expect(facets.bodyType).toEqual([
      { value: "sedan", count: 4 },
      { value: "wagon", count: 0 },
    ]);
  });

  it("orders brand facets by count desc, then label asc, then slug asc", () => {
    const raw = emptyRawFacets({
      brand: [
        { value: "bmw", label: "BMW", count: 2 },
        { value: "audi", label: "Audi", count: 2 },
        { value: "zonda", label: "Zonda", count: 5 },
      ],
    });
    expect(toVehicleFacets(raw, filters()).brand.map((b) => b.value)).toEqual([
      "zonda",
      "audi",
      "bmw",
    ]);
  });

  it("never produces a null drivetrain option", () => {
    const raw = emptyRawFacets({
      drivetrain: [
        { value: "awd", count: 2 },
        { value: "fwd", count: 1 },
      ],
    });
    const facets = toVehicleFacets(raw, filters());
    expect(facets.drivetrain.map((d) => d.value)).not.toContain("null");
  });

  it("passes numeric ranges through unchanged", () => {
    const raw = emptyRawFacets({
      year: { min: 2005, max: 2025 },
      price: { min: 1000, max: 9000 },
    });
    const facets = toVehicleFacets(raw, filters());
    expect(facets.year).toEqual({ min: 2005, max: 2025 });
    expect(facets.price).toEqual({ min: 1000, max: 9000 });
  });
});

describe("service.executeCatalogueSearch orchestration", () => {
  it("maps records, fixes page size at 24, and attaches applied filters, sort, and facets", async () => {
    const searchVehicles = vi
      .fn()
      .mockResolvedValue({ items: [cardRecord()], total: 30 });
    const getVehicleFacets = vi
      .fn()
      .mockResolvedValue(
        emptyRawFacets({ bodyType: [{ value: "suv", count: 5 }] }),
      );
    const service = createPublicVehicleService({
      repository: fakeRepository({ searchVehicles, getVehicleFacets }),
    });

    const result = await service.executeCatalogueSearch({
      mode: "sale",
      filters: filters({ bodyType: "suv", priceMin: 1000 }),
      sort: "price_asc",
      page: 2,
    });

    expect(searchVehicles).toHaveBeenCalledWith({
      mode: "sale",
      filters: filters({ bodyType: "suv", priceMin: 1000 }),
      sort: "price_asc",
      page: 2,
      pageSize: 24,
    });
    expect(getVehicleFacets).toHaveBeenCalledWith({
      mode: "sale",
      filters: filters({ bodyType: "suv", priceMin: 1000 }),
    });
    expect(result).toMatchObject({
      page: 2,
      pageSize: 24,
      totalItems: 30,
      totalPages: 2,
      sort: "price_asc",
      appliedFilters: { bodyType: "suv", priceMin: 1000 },
    });
    expect(result.facets.bodyType).toEqual([{ value: "suv", count: 5 }]);
  });

  it("normalizes a malformed page to 1 before querying", async () => {
    const searchVehicles = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const service = createPublicVehicleService({
      repository: fakeRepository({ searchVehicles }),
    });
    await service.executeCatalogueSearch({
      mode: "all",
      filters: filters(),
      sort: "newest",
      page: 0,
    });
    expect(searchVehicles).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 24 }),
    );
  });

  it("produces a JSON-serializable result with no private fields", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        searchVehicles: vi
          .fn()
          .mockResolvedValue({ items: [cardRecord()], total: 1 }),
      }),
    });
    const normalized = await service.executeCatalogueSearch({
      mode: "all",
      filters: filters(),
      sort: "newest",
      page: 1,
    });
    const serialized = JSON.stringify(normalized);
    for (const forbidden of [
      "registrationNumber",
      "chassisNumber",
      "publicId",
      "searchText",
      "searchVector",
      "brandId",
      "listingState",
      "lastVerifiedAt",
      "updatedById",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("attachIgnoredFilters", () => {
  it("adds request-scoped ignored filters without mutating the cached result", () => {
    const cached: NormalizedCatalogueResult = {
      items: [],
      page: 1,
      pageSize: 24,
      totalItems: 0,
      totalPages: 0,
      hasPreviousPage: false,
      hasNextPage: false,
      appliedFilters: {},
      sort: "newest",
      facets: toVehicleFacets(emptyRawFacets(), filters()),
    };
    const result = attachIgnoredFilters(cached, [
      { key: "yearMin", reason: "invalid_integer" },
    ]);
    expect(result.meta.ignoredFilters).toHaveLength(1);
    expect(cached).not.toHaveProperty("meta");
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
