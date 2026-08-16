import { describe, expect, it, vi } from "vitest";

import { createPublicVehicleService } from "@/server/modules/vehicles/public-service";
import type {
  PublicVehicleRepository,
  VehiclePublicCardRecord,
  VehiclePublicDetailRecord,
  VehicleSitemapRecord,
} from "@/server/modules/vehicles/public-repository";

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

function detailRecord(
  overrides: Partial<VehiclePublicDetailRecord> = {},
): VehiclePublicDetailRecord {
  return {
    ...cardRecord(),
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "diesel",
    driverNote: null,
    isNegotiable: false,
    mileageKm: 50_000,
    engineCc: 4500,
    engineDescription: null,
    seats: 7,
    doors: 5,
    exteriorColor: "Black",
    interiorColor: null,
    drivetrain: "awd",
    features: [],
    description: "A safe public description with more than forty characters.",
    ...overrides,
  } as VehiclePublicDetailRecord;
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

function emptyRawFacets() {
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
  };
}

describe("public vehicle catalogue service — sitemap", () => {
  it("includes only centrally indexable candidates", async () => {
    const candidates = [
      {
        slug: "active-sale",
        listingState: "published",
        isForSale: true,
        saleStatus: "available",
        salePrice: BigInt(10),
        isForRent: false,
        rentalStatus: null,
        rentalDailyPrice: null,
        minRentalDays: null,
      },
      {
        slug: "sold-history",
        listingState: "published",
        isForSale: true,
        saleStatus: "sold",
        salePrice: BigInt(10),
        isForRent: false,
        rentalStatus: null,
        rentalDailyPrice: null,
        minRentalDays: null,
      },
      {
        slug: "rented-only",
        listingState: "published",
        isForSale: false,
        saleStatus: null,
        salePrice: null,
        isForRent: true,
        rentalStatus: "rented",
        rentalDailyPrice: BigInt(10),
        minRentalDays: 1,
      },
      {
        slug: "archived",
        listingState: "archived",
        isForSale: true,
        saleStatus: "available",
        salePrice: BigInt(10),
        isForRent: false,
        rentalStatus: null,
        rentalDailyPrice: null,
        minRentalDays: null,
      },
    ] as VehicleSitemapRecord[];
    const service = createPublicVehicleService({
      repository: fakeRepository({
        listSitemapCandidates: vi.fn().mockResolvedValue(candidates),
      }),
    });

    await expect(service.listIndexableSlugs()).resolves.toEqual([
      "active-sale",
    ]);
  });
});

describe("public vehicle catalogue service — pagination", () => {
  it("requests page 1 with the fixed page size and shapes the result", async () => {
    const listActiveCatalogue = vi
      .fn()
      .mockResolvedValue({ items: [cardRecord()], total: 60 });
    const service = createPublicVehicleService({
      repository: fakeRepository({ listActiveCatalogue }),
    });
    const page = await service.listActiveCatalogue(2);
    expect(listActiveCatalogue).toHaveBeenCalledWith({ page: 2, pageSize: 24 });
    expect(page).toMatchObject({
      page: 2,
      pageSize: 24,
      totalItems: 60,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    });
    expect(page.items[0]?.presentation.badge).toBe("for-sale");
  });

  it("normalizes a malformed page to 1 before querying", async () => {
    const listSaleCatalogue = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0 });
    const service = createPublicVehicleService({
      repository: fakeRepository({ listSaleCatalogue }),
    });
    await service.listSaleCatalogue(0);
    await service.listSaleCatalogue(-5);
    await service.listSaleCatalogue(Number.NaN);
    for (const call of listSaleCatalogue.mock.calls) {
      expect(call[0]).toEqual({ page: 1, pageSize: 24 });
    }
  });
});

describe("public vehicle catalogue service — strips and featured", () => {
  it("maps featured, sale-strip, and rental-strip records to cards", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        listFeatured: vi.fn().mockResolvedValue([cardRecord()]),
        listSaleStrip: vi.fn().mockResolvedValue([cardRecord()]),
        listRentalStrip: vi.fn().mockResolvedValue([
          cardRecord({
            isForSale: false,
            saleStatus: null,
            salePrice: null,
            isForRent: true,
            rentalStatus: "available",
            rentalDailyPrice: BigInt(200_000),
            minRentalDays: 2,
          }),
        ]),
      }),
    });
    expect((await service.listFeatured())[0]?.presentation.badge).toBe(
      "for-sale",
    );
    expect((await service.listSaleStrip())[0]?.salePrice).toBe(150_000_000);
    expect((await service.listRentalStrip())[0]?.presentation.badge).toBe(
      "for-rent",
    );
  });
});

describe("public vehicle catalogue service — detail resolution", () => {
  it("returns 404 for a malformed slug without querying", async () => {
    const getDetailBySlug = vi.fn();
    const service = createPublicVehicleService({
      repository: fakeRepository({ getDetailBySlug }),
    });
    await expect(service.getPublicDetail("   ")).rejects.toMatchObject({
      status: 404,
    });
    expect(getDetailBySlug).not.toHaveBeenCalled();
  });

  it("returns 404 when the record is missing or a draft (null)", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        getDetailBySlug: vi.fn().mockResolvedValue(null),
      }),
    });
    await expect(service.getPublicDetail("missing")).rejects.toMatchObject({
      status: 404,
      code: "VEHICLE_NOT_FOUND",
    });
  });

  it("resolves an active vehicle with related available vehicles and index/follow", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        getDetailBySlug: vi.fn().mockResolvedValue(detailRecord()),
        listRelated: vi
          .fn()
          .mockResolvedValue([cardRecord({ id: "rel-1", slug: "rel-1" })]),
      }),
    });
    const result = await service.getPublicDetail(
      "toyota-land-cruiser-2025-abcd",
    );
    expect(result.presentation.state).toBe("active");
    expect(result.robots).toEqual({ index: true, follow: true });
    expect(result.related).toHaveLength(1);
    expect(result.vehicle.salePrice).toBe(150_000_000);
  });

  it("resolves a published sold sale-only vehicle as historical with no purchase action", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        getDetailBySlug: vi
          .fn()
          .mockResolvedValue(detailRecord({ saleStatus: "sold" })),
      }),
    });
    const result = await service.getPublicDetail("sold-slug");
    expect(result.presentation.state).toBe("sold-historical");
    expect(result.presentation.saleActionable).toBe(false);
    expect(result.presentation.inquiryAllowed).toBe(false);
    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("resolves an archived vehicle as retired with noindex/nofollow and no actions", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        getDetailBySlug: vi
          .fn()
          .mockResolvedValue(detailRecord({ listingState: "archived" })),
      }),
    });
    const result = await service.getPublicDetail("archived-slug");
    expect(result.presentation.state).toBe("retired");
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.presentation.inquiryAllowed).toBe(false);
  });

  it("keeps a sold-but-rental-available vehicle active and rentable", async () => {
    const service = createPublicVehicleService({
      repository: fakeRepository({
        getDetailBySlug: vi.fn().mockResolvedValue(
          detailRecord({
            saleStatus: "sold",
            isForRent: true,
            rentalStatus: "available",
            rentalDailyPrice: BigInt(250_000),
            minRentalDays: 2,
          }),
        ),
      }),
    });
    const result = await service.getPublicDetail("sold-rentable");
    expect(result.presentation.state).toBe("active");
    expect(result.presentation.rentalActionable).toBe(true);
    expect(result.presentation.saleActionable).toBe(false);
    expect(result.presentation.showSalePrice).toBe(false);
  });
});
