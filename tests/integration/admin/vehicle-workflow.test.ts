import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { createPrismaVehicleRepository } from "@/server/modules/vehicles/repository";
import { createVehicleService } from "@/server/modules/vehicles/service";
import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();
function client(): PrismaClient {
  return suite.getClient();
}
const ACTOR = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner" as const,
};

function service() {
  return createVehicleService({
    repository: createPrismaVehicleRepository(client()),
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    transaction: (operation, options) =>
      runInTransaction(
        async (tx) =>
          operation({ vehicles: createPrismaVehicleRepository(tx) }),
        options,
        client(),
      ),
  });
}

async function readyVehicle(slug: string, extra: Record<string, unknown> = {}) {
  const brand = await client().brand.create({
    data: { name: `Brand ${slug}`, slug: `brand-${slug}`, sortOrder: 1 },
  });
  return client().vehicle.create({
    data: {
      brandId: brand.id,
      brandName: brand.name,
      model: "Model",
      slug,
      year: 2022,
      bodyType: "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "diesel",
      drivetrain: "awd",
      driverOption: "without_driver",
      location: "Dar es Salaam",
      mileageKm: 20_000,
      seats: 5,
      exteriorColor: "Black",
      description:
        "A publication-ready vehicle description with more than forty characters.",
      isForSale: true,
      saleStatus: "available",
      salePrice: BigInt(50_000_000),
      images: {
        create: {
          publicId: `fake/${slug}`,
          secureUrl: `https://example.test/${slug}.jpg`,
          width: 1200,
          height: 800,
          format: "jpg",
          byteSize: 1000,
          altText: "Vehicle cover",
          sortOrder: 0,
          isCover: true,
        },
      },
      ...extra,
    },
  });
}

describe("vehicle lifecycle and public commercial visibility", () => {
  it("publishes through the sole transition entry point and preserves independent rental visibility", async () => {
    const vehicle = await readyVehicle("mode-visibility", {
      isForRent: true,
      rentalStatus: "available",
      rentalDailyPrice: BigInt(250_000),
      minRentalDays: 2,
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "publish",
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "sale_sold",
    });
    const publicVehicle = await service().getPublicBySlug(vehicle.slug);
    expect(publicVehicle).toMatchObject({
      saleStatus: "sold",
      rentalStatus: "available",
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "rental_rented",
    });
    await expect(service().getPublicBySlug(vehicle.slug)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("clears featured state atomically on unpublish/archive and verification changes no lifecycle fields", async () => {
    const vehicle = await readyVehicle("transition-clear", {
      listingState: "published",
      publishedAt: new Date(),
      isFeatured: true,
      featuredAt: new Date(),
    });
    const before = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    await service().markVerified(ACTOR, { vehicleId: vehicle.id });
    const verified = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    expect(verified.lastVerifiedAt).toEqual(
      new Date("2026-08-14T12:00:00.000Z"),
    );
    expect({
      listingState: verified.listingState,
      saleStatus: verified.saleStatus,
      rentalStatus: verified.rentalStatus,
    }).toEqual({
      listingState: before.listingState,
      saleStatus: before.saleStatus,
      rentalStatus: before.rentalStatus,
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "unpublish",
    });
    const draft = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    expect(draft).toMatchObject({
      listingState: "draft",
      isFeatured: false,
      featuredAt: null,
      publishedAt: null,
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "archive",
    });
    await service().transitionVehicle(ACTOR, {
      vehicleId: vehicle.id,
      action: "restore",
    });
    expect(
      await client().vehicle.findUniqueOrThrow({ where: { id: vehicle.id } }),
    ).toMatchObject({ listingState: "draft", publishedAt: null });
  });

  it("serializes concurrent eighth-slot attempts and safely rejects exactly one", async () => {
    for (let index = 0; index < 7; index += 1) {
      await readyVehicle(`featured-${index}`, {
        listingState: "published",
        publishedAt: new Date(),
        isFeatured: true,
        featuredAt: new Date(1_000 + index),
      });
    }
    const left = await readyVehicle("featured-left", {
      listingState: "published",
      publishedAt: new Date(),
    });
    const right = await readyVehicle("featured-right", {
      listingState: "published",
      publishedAt: new Date(),
    });
    const results = await Promise.allSettled([
      service().setFeatured(ACTOR, { vehicleId: left.id, featured: true }),
      service().setFeatured(ACTOR, { vehicleId: right.id, featured: true }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      reason: { status: 422, code: "FEATURED_LIMIT_REACHED" },
    });
    expect(await client().vehicle.count({ where: { isFeatured: true } })).toBe(
      8,
    );
  });
});
