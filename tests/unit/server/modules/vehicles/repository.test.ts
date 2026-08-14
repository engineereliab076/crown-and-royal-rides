import { describe, expect, it, vi } from "vitest";

import {
  createPrismaVehicleRepository,
  VEHICLE_ADMIN_SELECT,
  VEHICLE_PUBLIC_SELECT,
  type VehiclePrismaClient,
} from "@/server/modules/vehicles/repository";

function repositoryWith(
  vehicle: Record<string, unknown> = {},
  brand: Record<string, unknown> = {},
  vehicleImage: Record<string, unknown> = {},
) {
  return createPrismaVehicleRepository({
    vehicle,
    brand,
    vehicleImage,
  } as unknown as VehiclePrismaClient);
}

describe("Prisma vehicle repository", () => {
  it("uses explicit selections with no generated or private fields", () => {
    expect(VEHICLE_ADMIN_SELECT).not.toHaveProperty("searchText");
    expect(VEHICLE_ADMIN_SELECT).not.toHaveProperty("searchVector");
    expect(VEHICLE_ADMIN_SELECT).toHaveProperty("registrationNumber", true);
    expect(VEHICLE_ADMIN_SELECT).toHaveProperty("chassisNumber", true);
    expect(VEHICLE_PUBLIC_SELECT).not.toHaveProperty("brandId");
    expect(VEHICLE_PUBLIC_SELECT).not.toHaveProperty("listingState");
    expect(VEHICLE_PUBLIC_SELECT).not.toHaveProperty("registrationNumber");
    expect(VEHICLE_PUBLIC_SELECT).not.toHaveProperty("chassisNumber");
  });

  it("filters public lookup to published listings", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await repositoryWith({ findFirst }).getPublicBySlug("safe-slug");
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { slug: "safe-slug", listingState: "published" },
      select: VEHICLE_PUBLIC_SELECT,
    });
  });

  it("uses deterministic bounded pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await repositoryWith({ findMany, count }).listAdmin({ page: 2, limit: 20 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: 20,
      take: 20,
      select: VEHICLE_ADMIN_SELECT,
    });
  });

  it("publishes by setting state and timestamp with the safe select", async () => {
    const update = vi.fn().mockResolvedValue({});
    const publishedAt = new Date("2026-01-01T00:00:00.000Z");
    await repositoryWith({ update }).publish("vehicle-id", publishedAt);
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "vehicle-id" },
      data: { listingState: "published", publishedAt },
      select: VEHICLE_ADMIN_SELECT,
    });
  });

  it("attaches exactly one sort-zero cover with trusted fields", async () => {
    const update = vi.fn().mockResolvedValue({});
    const image = {
      publicId: "dev/vehicles/vehicle/id/asset-id",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/safe.jpg",
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 245_000,
      altText: "Toyota cover image",
    };
    await repositoryWith({ update }).createCover("vehicle-id", image);
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "vehicle-id" },
      data: {
        images: { create: { ...image, sortOrder: 0, isCover: true } },
      },
      select: VEHICLE_ADMIN_SELECT,
    });
  });

  it("checks attachment by provider public ID with an ID-only projection", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await repositoryWith({}, {}, { findFirst }).findImageByPublicId(
      "safe-public-id",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { publicId: "safe-public-id" },
      select: { id: true },
    });
  });
});
