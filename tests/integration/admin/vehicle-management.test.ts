import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaVehicleRepository } from "@/server/modules/vehicles/repository";

import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

async function brand() {
  return client().brand.create({
    data: { name: "Toyota", slug: "toyota", sortOrder: 1 },
  });
}

function input(brandId: string, slug: string, model = "Land Cruiser") {
  return {
    brandId,
    brandName: "Toyota",
    model,
    slug,
    year: 2025,
    bodyType: "suv" as const,
    condition: "foreign_used" as const,
    transmission: "automatic" as const,
    fuelType: "diesel" as const,
    driverOption: "without_driver" as const,
    isForSale: true,
    saleStatus: "available" as const,
    salePrice: BigInt(150_000_000),
    description: "A complete repository integration vehicle description.",
  };
}

describe("vehicle repository integration", () => {
  it("creates with denormalized brand name and database-generated search fields", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const created = await repository.create(
      input(createdBrand.id, "toyota-land-cruiser-2025-first"),
    );
    expect(created.brandName).toBe("Toyota");
    const rows = await client().$queryRaw<
      Array<{ search_text: string; search_vector: string }>
    >`
      SELECT search_text, search_vector::text
      FROM vehicles
      WHERE id = ${created.id}::uuid
    `;
    expect(rows[0]?.search_text).toContain("Toyota Land Cruiser");
    expect(rows[0]?.search_vector).toContain("toyota");
  });

  it("excludes drafts publicly and persists publication", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const slug = "toyota-land-cruiser-2025-public";
    const created = await repository.create(input(createdBrand.id, slug));
    await expect(repository.getPublicBySlug(slug)).resolves.toBeNull();
    const publishedAt = new Date("2026-03-01T00:00:00.000Z");
    const published = await repository.publish(created.id, publishedAt);
    expect(published).toMatchObject({ listingState: "published", publishedAt });
    await expect(repository.getPublicBySlug(slug)).resolves.toMatchObject({
      id: created.id,
      slug,
    });
  });

  it("orders and paginates deterministically", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const first = await repository.create(
      input(createdBrand.id, "toyota-first-2025-a", "First"),
    );
    const second = await repository.create(
      input(createdBrand.id, "toyota-second-2025-b", "Second"),
    );
    await client().vehicle.update({
      where: { id: first.id },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    await client().vehicle.update({
      where: { id: second.id },
      data: { createdAt: new Date("2026-02-01T00:00:00.000Z") },
    });
    const pageOne = await repository.listAdmin({ page: 1, limit: 1 });
    const pageTwo = await repository.listAdmin({ page: 2, limit: 1 });
    expect(pageOne).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(pageOne.items[0]?.id).toBe(second.id);
    expect(pageTwo.items[0]?.id).toBe(first.id);
  });

  it("persists a verified cover, publishes, and returns it publicly", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const slug = "toyota-land-cruiser-2025-cover-publish";
    const created = await repository.create(input(createdBrand.id, slug));
    const withCover = await repository.createCover(created.id, {
      publicId: `test/vehicles/vehicle/${created.id}/asset-cover`,
      secureUrl:
        "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/cover.jpg",
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 245_000,
      altText: "Toyota Land Cruiser cover image",
    });
    expect(withCover.images).toMatchObject([
      {
        secureUrl:
          "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/cover.jpg",
        width: 1600,
        height: 900,
        altText: "Toyota Land Cruiser cover image",
        isCover: true,
        sortOrder: 0,
      },
    ]);
    // The safe public image DTO now also carries the image id.
    expect(withCover.images[0]?.id).toEqual(expect.any(String));
    const stored = await client().vehicleImage.findFirstOrThrow({
      where: { vehicleId: created.id },
    });
    expect(stored).toMatchObject({
      publicId: `test/vehicles/vehicle/${created.id}/asset-cover`,
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 245_000,
      isCover: true,
      sortOrder: 0,
    });

    const publishedAt = new Date("2026-04-01T00:00:00.000Z");
    await repository.publish(created.id, publishedAt);
    await expect(repository.getPublicBySlug(slug)).resolves.toMatchObject({
      id: created.id,
      images: [
        {
          secureUrl:
            "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/cover.jpg",
          isCover: true,
        },
      ],
    });
  });

  it("preserves the partial unique cover defense through repository attachment", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const created = await repository.create(
      input(createdBrand.id, "toyota-land-cruiser-2025-duplicate-cover"),
    );
    const cover = {
      publicId: `test/vehicles/vehicle/${created.id}/asset-first`,
      secureUrl:
        "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/first.jpg",
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 245_000,
      altText: "First cover",
    };
    await repository.createCover(created.id, cover);
    await expect(
      repository.createCover(created.id, {
        ...cover,
        publicId: `test/vehicles/vehicle/${created.id}/asset-second`,
        secureUrl:
          "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/second.jpg",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await client().vehicleImage.count({ where: { vehicleId: created.id } }),
    ).toBe(1);
  });

  it("leaves no image row when nested attachment targets a missing vehicle", async () => {
    const createdBrand = await brand();
    const repository = createPrismaVehicleRepository(client());
    const created = await repository.create(
      input(createdBrand.id, "toyota-land-cruiser-2025-invalid-cover"),
    );
    const missingVehicleId = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
    await expect(
      repository.createCover(missingVehicleId, {
        publicId: `test/vehicles/vehicle/${created.id}/asset-invalid`,
        secureUrl:
          "https://res.cloudinary.com/test-cloud/image/upload/v1/test/vehicles/invalid.jpg",
        width: 0,
        height: 900,
        format: "jpg",
        byteSize: 245_000,
        altText: "Invalid cover",
      }),
    ).rejects.toBeDefined();
    expect(await client().vehicleImage.count()).toBe(0);
  });
});
