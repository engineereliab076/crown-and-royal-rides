import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { createPrismaPublicVehicleRepository } from "@/server/modules/vehicles/public-repository";
import { createPublicVehicleService } from "@/server/modules/vehicles/public-service";
import { createPrismaVehicleRepository } from "@/server/modules/vehicles/repository";
import { createVehicleService } from "@/server/modules/vehicles/service";
import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

function publicService() {
  return createPublicVehicleService({
    repository: createPrismaPublicVehicleRepository(client()),
  });
}

interface FixtureBrand {
  readonly id: string;
  readonly name: string;
}

interface VehicleFixture {
  readonly slug: string;
  readonly id?: string;
  readonly brand?: FixtureBrand;
  readonly brandName?: string;
  readonly bodyType?: "sedan" | "suv" | "pickup";
  readonly listingState?: "draft" | "published" | "archived";
  readonly publishedAt?: Date;
  readonly isForSale?: boolean;
  readonly saleStatus?: "available" | "reserved" | "sold";
  readonly salePrice?: bigint;
  readonly isForRent?: boolean;
  readonly rentalStatus?: "available" | "reserved" | "rented" | "unavailable";
  readonly rentalDailyPrice?: bigint;
  readonly minRentalDays?: number;
  readonly isFeatured?: boolean;
  readonly featuredAt?: Date;
  readonly registrationNumber?: string;
  readonly chassisNumber?: string;
  readonly imageAltTexts?: readonly (string | null)[];
}

async function createBrand(key: string, name = `Phase 6 ${key}`) {
  return client().brand.create({
    data: {
      name,
      slug: `phase6-${key}`,
      sortOrder: 1,
    },
    select: { id: true, name: true },
  });
}

async function createVehicle(defaultBrand: FixtureBrand, fixture: VehicleFixture) {
  const brand = fixture.brand ?? defaultBrand;
  const listingState = fixture.listingState ?? "published";
  const isForSale = fixture.isForSale ?? false;
  const isForRent = fixture.isForRent ?? false;
  const isFeatured = fixture.isFeatured ?? false;
  const imageAltTexts = fixture.imageAltTexts ?? [];

  return client().vehicle.create({
    data: {
      ...(fixture.id === undefined ? {} : { id: fixture.id }),
      brandId: brand.id,
      brandName: fixture.brandName ?? brand.name,
      model: `Model ${fixture.slug}`,
      slug: fixture.slug,
      year: 2024,
      bodyType: fixture.bodyType ?? "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "diesel",
      driverOption: "without_driver",
      listingState,
      publishedAt:
        listingState === "published"
          ? (fixture.publishedAt ?? new Date("2026-08-01T00:00:00.000Z"))
          : null,
      isForSale,
      saleStatus: isForSale ? (fixture.saleStatus ?? "available") : null,
      salePrice: isForSale
        ? (fixture.salePrice ?? BigInt(50_000_000))
        : null,
      isForRent,
      rentalStatus: isForRent
        ? (fixture.rentalStatus ?? "available")
        : null,
      rentalDailyPrice: isForRent
        ? (fixture.rentalDailyPrice ?? BigInt(250_000))
        : null,
      minRentalDays: isForRent ? (fixture.minRentalDays ?? 2) : null,
      isFeatured,
      featuredAt: isFeatured
        ? (fixture.featuredAt ?? new Date("2026-08-02T00:00:00.000Z"))
        : null,
      location: "Dar es Salaam",
      description:
        "A unique Phase 6 public catalogue integration fixture description.",
      registrationNumber: fixture.registrationNumber,
      chassisNumber: fixture.chassisNumber,
      ...(imageAltTexts.length === 0
        ? {}
        : {
            images: {
              create: imageAltTexts.map((altText, index) => ({
                publicId: `phase6/${fixture.slug}/${index}`,
                secureUrl: `https://example.test/phase6/${fixture.slug}/${index}.jpg`,
                width: 1600,
                height: 900,
                format: "jpg",
                byteSize: 1_024,
                altText,
                sortOrder: index,
                isCover: index === 0,
              })),
            },
          }),
    },
  });
}

describe("public vehicle catalogue against PostgreSQL", () => {
  it("enforces the active, sale, and rental inclusion and exclusion matrix", async () => {
    const brand = await createBrand("catalogue-matrix");
    const fixtures: VehicleFixture[] = [
      {
        slug: "phase6-sale-available",
        isForSale: true,
        imageAltTexts: [null],
      },
      {
        slug: "phase6-sale-reserved",
        isForSale: true,
        saleStatus: "reserved",
        imageAltTexts: ["Reserved sale vehicle"],
      },
      {
        slug: "phase6-rental-available",
        isForRent: true,
        imageAltTexts: ["Rental vehicle"],
      },
      {
        slug: "phase6-rental-reserved",
        isForRent: true,
        rentalStatus: "reserved",
        imageAltTexts: ["   "],
      },
      {
        slug: "phase6-dual-one-usable-mode",
        isForSale: true,
        saleStatus: "sold",
        isForRent: true,
        rentalStatus: "available",
      },
      {
        slug: "phase6-draft-sale",
        listingState: "draft",
        isForSale: true,
      },
      {
        slug: "phase6-archived-sale",
        listingState: "archived",
        isForSale: true,
      },
      {
        slug: "phase6-sold-sale-only",
        isForSale: true,
        saleStatus: "sold",
      },
      {
        slug: "phase6-rented-rental-only",
        isForRent: true,
        rentalStatus: "rented",
      },
      {
        slug: "phase6-unavailable-rental-only",
        isForRent: true,
        rentalStatus: "unavailable",
      },
      { slug: "phase6-no-commercial-mode" },
    ];
    for (const fixture of fixtures) await createVehicle(brand, fixture);

    const service = publicService();
    const active = await service.listActiveCatalogue(1);
    const sale = await service.listSaleCatalogue(1);
    const rental = await service.listRentalCatalogue(1);

    expect(active.items.map((vehicle) => vehicle.slug).sort()).toEqual(
      [
        "phase6-dual-one-usable-mode",
        "phase6-rental-available",
        "phase6-rental-reserved",
        "phase6-sale-available",
        "phase6-sale-reserved",
      ].sort(),
    );
    expect(sale.items.map((vehicle) => vehicle.slug).sort()).toEqual(
      ["phase6-sale-available", "phase6-sale-reserved"].sort(),
    );
    expect(
      sale.items.every(
        (vehicle) => vehicle.salePrice !== null && vehicle.salePrice > 0,
      ),
    ).toBe(true);
    expect(rental.items.map((vehicle) => vehicle.slug).sort()).toEqual(
      [
        "phase6-dual-one-usable-mode",
        "phase6-rental-available",
        "phase6-rental-reserved",
      ].sort(),
    );
    expect(
      rental.items.every(
        (vehicle) =>
          vehicle.rentalDailyPrice !== null &&
          vehicle.rentalDailyPrice > 0 &&
          vehicle.minRentalDays !== null &&
          vehicle.minRentalDays >= 1,
      ),
    ).toBe(true);
    expect(
      [...active.items, ...sale.items, ...rental.items]
        .flatMap((vehicle) =>
          vehicle.coverImage === null ? [] : [vehicle.coverImage],
        )
        .every((image) => image.altText.trim().length > 0),
    ).toBe(true);
  });

  it("limits featured results to eight usable vehicles in deterministic order", async () => {
    const brand = await createBrand("featured");
    const featuredAt = new Date("2026-08-03T00:00:00.000Z");
    for (let index = 1; index <= 9; index += 1) {
      await createVehicle(brand, {
        id: `61000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        slug: `phase6-featured-usable-${index}`,
        isForSale: true,
        isFeatured: true,
        featuredAt,
      });
    }
    await createVehicle(brand, {
      slug: "phase6-featured-draft",
      listingState: "draft",
      isForSale: true,
      isFeatured: true,
      featuredAt,
    });
    await createVehicle(brand, {
      slug: "phase6-featured-archived",
      listingState: "archived",
      isForSale: true,
      isFeatured: true,
      featuredAt,
    });
    await createVehicle(brand, {
      slug: "phase6-featured-sold",
      isForSale: true,
      saleStatus: "sold",
      isFeatured: true,
      featuredAt,
    });
    await createVehicle(brand, {
      slug: "phase6-featured-rental-unavailable",
      isForRent: true,
      rentalStatus: "unavailable",
      isFeatured: true,
      featuredAt,
    });

    const featured = await publicService().listFeatured();
    expect(featured).toHaveLength(8);
    expect(featured.map((vehicle) => vehicle.slug)).toEqual(
      Array.from(
        { length: 8 },
        (_, index) => `phase6-featured-usable-${index + 1}`,
      ),
    );
    expect(
      featured.every(
        (vehicle) =>
          vehicle.isFeatured && vehicle.presentation.state === "active",
      ),
    ).toBe(true);
  });

  it("resolves detail states, keeps reserved prices visible, and returns safe DTOs", async () => {
    const brand = await createBrand("detail");
    await createVehicle(brand, {
      slug: "phase6-detail-draft",
      listingState: "draft",
      isForSale: true,
    });
    await createVehicle(brand, {
      slug: "phase6-detail-archived",
      listingState: "archived",
      isForSale: true,
    });
    await createVehicle(brand, {
      slug: "phase6-detail-sold",
      isForSale: true,
      saleStatus: "sold",
    });
    await createVehicle(brand, {
      slug: "phase6-detail-sold-rentable",
      isForSale: true,
      saleStatus: "sold",
      isForRent: true,
      rentalStatus: "available",
    });
    await createVehicle(brand, {
      slug: "phase6-detail-reserved",
      isForSale: true,
      saleStatus: "reserved",
      salePrice: BigInt(Number.MAX_SAFE_INTEGER),
      registrationNumber: "PHASE6-PRIVATE-REGISTRATION",
      chassisNumber: "PHASE6-PRIVATE-CHASSIS",
      imageAltTexts: [null, "   "],
    });

    const service = publicService();
    await expect(service.getPublicDetail("phase6-detail-missing")).rejects.toMatchObject(
      { status: 404, code: "VEHICLE_NOT_FOUND" },
    );
    await expect(service.getPublicDetail("phase6-detail-draft")).rejects.toMatchObject(
      { status: 404, code: "VEHICLE_NOT_FOUND" },
    );

    const archived = await service.getPublicDetail("phase6-detail-archived");
    expect(archived.presentation.state).toBe("retired");

    const sold = await service.getPublicDetail("phase6-detail-sold");
    expect(sold.presentation).toMatchObject({
      state: "sold-historical",
      inquiryAllowed: false,
      whatsappAllowed: false,
    });

    const rentable = await service.getPublicDetail(
      "phase6-detail-sold-rentable",
    );
    expect(rentable.presentation).toMatchObject({
      state: "active",
      saleActionable: false,
      rentalActionable: true,
      showSalePrice: false,
    });

    const reserved = await service.getPublicDetail("phase6-detail-reserved");
    expect(reserved.presentation).toMatchObject({
      state: "active",
      badge: "reserved",
      saleActionable: false,
      rentalActionable: false,
      showSalePrice: true,
      inquiryAllowed: false,
      whatsappAllowed: false,
      indexable: true,
      robots: { index: true, follow: true },
    });
    expect(reserved.vehicle.salePrice).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      reserved.vehicle.images.every(
        (image) => image.altText.trim().length > 0,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(reserved);
    expect(serialized).not.toContain("registrationNumber");
    expect(serialized).not.toContain("chassisNumber");
    expect(serialized).not.toContain("PHASE6-PRIVATE-REGISTRATION");
    expect(serialized).not.toContain("PHASE6-PRIVATE-CHASSIS");
  });

  it("paginates 49 tied rows without duplicates or gaps at 24 per page and handles pages beyond the end", async () => {
    const brand = await createBrand("pagination");
    const publishedAt = new Date("2026-08-04T00:00:00.000Z");
    const expectedIds: string[] = [];
    for (let index = 1; index <= 49; index += 1) {
      const id = `62000000-0000-4000-8000-${index
        .toString()
        .padStart(12, "0")}`;
      expectedIds.push(id);
      await createVehicle(brand, {
        id,
        slug: `phase6-page-${index.toString().padStart(2, "0")}`,
        isForSale: true,
        publishedAt,
      });
    }

    const service = publicService();
    const first = await service.listActiveCatalogue(1);
    const second = await service.listActiveCatalogue(2);
    const third = await service.listActiveCatalogue(3);
    const beyond = await service.listActiveCatalogue(4);
    const allIds = [...first.items, ...second.items, ...third.items].map(
      (vehicle) => vehicle.id,
    );

    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(24);
    expect(third.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(
      48,
    );
    expect(allIds).toEqual(expectedIds);
    expect(new Set(allIds).size).toBe(49);
    expect(first).toMatchObject({
      page: 1,
      pageSize: 24,
      totalItems: 49,
      totalPages: 3,
      hasPreviousPage: false,
      hasNextPage: true,
    });
    expect(second).toMatchObject({
      page: 2,
      pageSize: 24,
      totalItems: 49,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    });
    expect(beyond).toMatchObject({
      items: [],
      page: 4,
      pageSize: 24,
      totalItems: 49,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it("returns at most four related vehicles, preferring brand/body before deterministic fallback", async () => {
    const primary = await createBrand("related-primary", "Phase 6 Primary");
    const secondary = await createBrand(
      "related-secondary",
      "Phase 6 Secondary",
    );
    const at = (seconds: number) =>
      new Date(Date.UTC(2026, 7, 5, 0, 0, seconds));

    await createVehicle(primary, {
      slug: "phase6-related-current",
      isForSale: true,
      publishedAt: at(1),
    });
    await createVehicle(primary, {
      slug: "phase6-related-same-brand-newest",
      bodyType: "sedan",
      isForSale: true,
      publishedAt: at(6),
    });
    await createVehicle(primary, {
      slug: "phase6-related-same-brand-older",
      bodyType: "pickup",
      isForSale: true,
      publishedAt: at(4),
    });
    await createVehicle(primary, {
      slug: "phase6-related-same-body",
      brand: secondary,
      bodyType: "suv",
      isForRent: true,
      publishedAt: at(5),
    });
    await createVehicle(primary, {
      slug: "phase6-related-fallback-newest",
      brand: secondary,
      bodyType: "sedan",
      isForSale: true,
      publishedAt: at(10),
    });
    await createVehicle(primary, {
      slug: "phase6-related-fallback-older",
      brand: secondary,
      bodyType: "pickup",
      isForSale: true,
      publishedAt: at(9),
    });
    await createVehicle(primary, {
      slug: "phase6-related-draft",
      listingState: "draft",
      isForSale: true,
    });
    await createVehicle(primary, {
      slug: "phase6-related-archived",
      listingState: "archived",
      isForSale: true,
    });
    await createVehicle(primary, {
      slug: "phase6-related-sold-only",
      isForSale: true,
      saleStatus: "sold",
    });
    await createVehicle(primary, {
      slug: "phase6-related-rented-only",
      isForRent: true,
      rentalStatus: "rented",
    });
    await createVehicle(primary, {
      slug: "phase6-related-unavailable",
      isForRent: true,
      rentalStatus: "unavailable",
    });

    const result = await publicService().getPublicDetail(
      "phase6-related-current",
    );
    expect(result.related).toHaveLength(4);
    expect(result.related.map((vehicle) => vehicle.slug)).toEqual([
      "phase6-related-same-brand-newest",
      "phase6-related-same-body",
      "phase6-related-same-brand-older",
      "phase6-related-fallback-newest",
    ]);
    expect(result.related.some((vehicle) => vehicle.id === result.vehicle.id)).toBe(
      false,
    );
  });

  it("commits a vehicle mutation even when mocked post-commit revalidation fails", async () => {
    const brand = await createBrand("revalidation");
    const vehicle = await createVehicle(brand, {
      slug: "phase6-revalidation-commit",
      isForSale: true,
    });
    const attemptedSlugs: string[] = [];
    const reportedCorrelations: string[] = [];
    const service = createVehicleService({
      repository: createPrismaVehicleRepository(client()),
      transaction: (operation, options) =>
        runInTransaction(
          async (tx) =>
            operation({ vehicles: createPrismaVehicleRepository(tx) }),
          options,
          client(),
        ),
      revalidateVehicle: async (slug) => {
        attemptedSlugs.push(slug);
        throw new Error("mocked cache failure");
      },
      reportCacheFailure: async (context) => {
        reportedCorrelations.push(context.correlationId);
      },
    });

    const result = await service.transitionVehicle(
      { id: "63000000-0000-4000-8000-000000000001", role: "owner" },
      { vehicleId: vehicle.id, action: "sale_reserved" },
      {
        correlationId: "phase6-revalidation-correlation",
        actorId: "63000000-0000-4000-8000-000000000001",
      },
    );

    expect(result.saleStatus).toBe("reserved");
    expect(attemptedSlugs).toEqual([vehicle.slug]);
    expect(reportedCorrelations).toEqual([
      "phase6-revalidation-correlation",
    ]);
    expect(
      await client().vehicle.findUniqueOrThrow({ where: { id: vehicle.id } }),
    ).toMatchObject({ saleStatus: "reserved" });
  });
});
