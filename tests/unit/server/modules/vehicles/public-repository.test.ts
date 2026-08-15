import { describe, expect, it, vi } from "vitest";

import {
  createPrismaPublicVehicleRepository,
  FEATURED_LIMIT,
  STRIP_LIMIT,
  VEHICLE_PUBLIC_CARD_SELECT,
  VEHICLE_PUBLIC_DETAIL_SELECT,
  type PublicVehiclePrismaClient,
} from "@/server/modules/vehicles/public-repository";

function mockClient(vehicle: Record<string, unknown>) {
  const repository = createPrismaPublicVehicleRepository({
    vehicle,
  } as unknown as PublicVehiclePrismaClient);
  return repository;
}

describe("public vehicle repository selects", () => {
  it("never selects private, generated, or listing-internal columns on cards", () => {
    for (const key of [
      "registrationNumber",
      "chassisNumber",
      "searchText",
      "searchVector",
      "lastVerifiedAt",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "brandId",
    ]) {
      expect(VEHICLE_PUBLIC_CARD_SELECT).not.toHaveProperty(key);
      expect(VEHICLE_PUBLIC_DETAIL_SELECT).not.toHaveProperty(key);
    }
  });
});

describe("public vehicle repository query semantics", () => {
  it("active catalogue: published with any usable mode, newest-first, bounded page", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await mockClient({ findMany, count }).listActiveCatalogue({
      page: 2,
      pageSize: 12,
    });
    const args = findMany.mock.calls[0]?.[0];
    expect(args.where.listingState).toBe("published");
    expect(args.where.OR).toHaveLength(2);
    expect(args.orderBy).toEqual([{ publishedAt: "desc" }, { id: "asc" }]);
    expect(args.skip).toBe(12);
    expect(args.take).toBe(12);
    expect(args.select).toBe(VEHICLE_PUBLIC_CARD_SELECT);
  });

  it("sale catalogue: published sale mode, available/reserved, positive price", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await mockClient({ findMany, count }).listSaleCatalogue({
      page: 1,
      pageSize: 12,
    });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      listingState: "published",
      isForSale: true,
      saleStatus: { in: ["available", "reserved"] },
      salePrice: { gt: BigInt(0) },
    });
  });

  it("rental catalogue: published rental mode, positive daily price, valid min days", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await mockClient({ findMany, count }).listRentalCatalogue({
      page: 1,
      pageSize: 12,
    });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      listingState: "published",
      isForRent: true,
      rentalStatus: { in: ["available", "reserved"] },
      rentalDailyPrice: { gt: BigInt(0) },
      minRentalDays: { gte: 1 },
    });
  });

  it("featured: published, featured, usable, deterministic order, max 8", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await mockClient({ findMany }).listFeatured();
    const args = findMany.mock.calls[0]?.[0];
    expect(args.where).toMatchObject({
      listingState: "published",
      isFeatured: true,
    });
    expect(args.orderBy).toEqual([{ featuredAt: "desc" }, { id: "asc" }]);
    expect(args.take).toBe(FEATURED_LIMIT);
    expect(FEATURED_LIMIT).toBe(8);
  });

  it("home strips are bounded to four each", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = mockClient({ findMany });
    await repository.listSaleStrip();
    await repository.listRentalStrip();
    expect(findMany.mock.calls[0]?.[0].take).toBe(STRIP_LIMIT);
    expect(findMany.mock.calls[1]?.[0].take).toBe(STRIP_LIMIT);
    expect(STRIP_LIMIT).toBe(4);
  });

  it("detail resolves published OR archived by slug (never draft)", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await mockClient({ findFirst }).getDetailBySlug("safe-slug");
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        slug: "safe-slug",
        listingState: { in: ["published", "archived"] },
      },
      select: VEHICLE_PUBLIC_DETAIL_SELECT,
    });
  });

  it("related excludes the current vehicle, prefers brand/body, then fills", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "pref-1" }])
      .mockResolvedValueOnce([{ id: "fill-1" }]);
    const result = await mockClient({ findMany }).listRelated({
      vehicleId: "current",
      brandName: "Toyota",
      bodyType: "suv",
      limit: 4,
    });
    // First (preferred) query: excludes current, requires usable + brand/body.
    const preferred = findMany.mock.calls[0]?.[0];
    expect(preferred.where.AND).toEqual(
      expect.arrayContaining([
        { id: { not: "current" } },
        { OR: [{ brandName: "Toyota" }, { bodyType: "suv" }] },
      ]),
    );
    // Second (fill) query: excludes current AND already-picked ids.
    const fill = findMany.mock.calls[1]?.[0];
    expect(fill.where.AND).toEqual(
      expect.arrayContaining([{ id: { notIn: ["current", "pref-1"] } }]),
    );
    expect(fill.take).toBe(3);
    expect(result.map((v) => v.id)).toEqual(["pref-1", "fill-1"]);
  });

  it("related does not run a fill query when preferred already fills the limit", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" },
      ]);
    await mockClient({ findMany }).listRelated({
      vehicleId: "current",
      brandName: "Toyota",
      bodyType: "suv",
      limit: 4,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
