import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { describeDatabaseError, postgresErrorCode } from "../support/errors";
import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Constraint, search, and relation behavior of the Phase 3 schema
 * (0002_vehicles, 0003_vehicle_images, 0004_inquiries), proven with inserts
 * against the real test database. Every value below is obviously fake.
 *
 * Failures are asserted by stable PostgreSQL SQLSTATE (23505 unique_violation,
 * 23514 check_violation) and by the stable constraint/index name carried in the
 * error — never by matching a whole database error message.
 */

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

async function createBrand(
  overrides: { name?: string; slug?: string; sortOrder?: number } = {},
): Promise<string> {
  const brand = await client().brand.create({
    data: {
      name: overrides.name ?? "Fake Motors",
      slug: overrides.slug ?? "fake-motors",
      sortOrder: overrides.sortOrder ?? 1,
    },
  });
  return brand.id;
}

interface VehicleOverrides {
  brandName?: string;
  model?: string;
  slug?: string;
  description?: string | null;
  isForSale?: boolean;
  saleStatus?: "available" | "reserved" | "sold" | null;
  salePrice?: bigint | null;
  year?: number;
}

function vehicleInput(brandId: string, overrides: VehicleOverrides = {}) {
  return {
    brandId,
    brandName: overrides.brandName ?? "Fake Motors",
    model: overrides.model ?? "FakeModel",
    slug: overrides.slug ?? "fake-model",
    year: overrides.year ?? 2020,
    bodyType: "suv" as const,
    condition: "foreign_used" as const,
    transmission: "automatic" as const,
    fuelType: "petrol" as const,
    driverOption: "without_driver" as const,
    ...(overrides.description !== undefined
      ? { description: overrides.description }
      : {}),
    ...(overrides.isForSale !== undefined
      ? { isForSale: overrides.isForSale }
      : {}),
    ...(overrides.saleStatus !== undefined
      ? { saleStatus: overrides.saleStatus }
      : {}),
    ...(overrides.salePrice !== undefined
      ? { salePrice: overrides.salePrice }
      : {}),
  };
}

async function createVehicle(
  brandId: string,
  overrides: VehicleOverrides = {},
): Promise<string> {
  const vehicle = await client().vehicle.create({
    data: vehicleInput(brandId, overrides),
  });
  return vehicle.id;
}

async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("vehicle sale-mode CHECK constraints", () => {
  it("accepts a not-for-sale vehicle with both sale fields NULL", async () => {
    const brandId = await createBrand();
    const vehicle = await client().vehicle.create({
      data: vehicleInput(brandId, { isForSale: false }),
    });
    expect(vehicle.isForSale).toBe(false);
    expect(vehicle.saleStatus).toBeNull();
    expect(vehicle.salePrice).toBeNull();
  });

  it("accepts a valid for-sale vehicle (status + positive price)", async () => {
    const brandId = await createBrand();
    const vehicle = await client().vehicle.create({
      data: vehicleInput(brandId, {
        isForSale: true,
        saleStatus: "available",
        salePrice: BigInt(75_000_000),
      }),
    });
    expect(vehicle.isForSale).toBe(true);
    expect(vehicle.salePrice).toBe(BigInt(75_000_000));
  });

  it("rejects is_for_sale = true with sale_status = NULL", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, {
          isForSale: true,
          saleStatus: null,
          salePrice: BigInt(75_000_000),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_sale_status_required_check",
    );
  });

  it("rejects is_for_sale = true with a missing (NULL) sale price", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, {
          isForSale: true,
          saleStatus: "available",
          salePrice: null,
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_sale_price_required_check",
    );
  });

  it("rejects a non-positive sale price", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, {
          isForSale: true,
          saleStatus: "available",
          salePrice: BigInt(0),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_sale_price_positive_check",
    );
  });

  it("rejects dangling sale fields when is_for_sale = false", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, {
          isForSale: false,
          saleStatus: "available",
          salePrice: BigInt(1),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_sale_disabled_null_check",
    );
  });

  // The bounds match createVehicleSlug() in src/lib/slug.ts: 1980 through 2100.
  it("accepts the lower boundary year 1980", async () => {
    const brandId = await createBrand();
    const vehicle = await client().vehicle.create({
      data: vehicleInput(brandId, { year: 1980, slug: "year-1980" }),
    });
    expect(vehicle.year).toBe(1980);
  });

  it("accepts the upper boundary year 2100", async () => {
    const brandId = await createBrand();
    const vehicle = await client().vehicle.create({
      data: vehicleInput(brandId, { year: 2100, slug: "year-2100" }),
    });
    expect(vehicle.year).toBe(2100);
  });

  it("rejects year 1979 (just below the lower boundary)", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, { year: 1979, slug: "year-1979" }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_year_range_check",
    );
  });

  it("rejects year 2101 (just above the upper boundary)", async () => {
    const brandId = await createBrand();
    const caught = await capture(() =>
      client().vehicle.create({
        data: vehicleInput(brandId, { year: 2101, slug: "year-2101" }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "vehicles_year_range_check",
    );
  });
});

describe("vehicle brand relation and denormalized brandName", () => {
  it("keeps the live brand relation and the captured brandName side by side", async () => {
    const brandId = await createBrand({
      name: "Royal Motors",
      slug: "royal-motors",
    });
    const vehicleId = await createVehicle(brandId, {
      brandName: "Royal Motors",
      slug: "royal-suv",
    });

    // Rename the brand after the fact; the denormalized copy must not change.
    await client().brand.update({
      where: { id: brandId },
      data: { name: "Royal Motors Renamed" },
    });

    const vehicle = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      include: { brand: true },
    });
    expect(vehicle.brand.id).toBe(brandId);
    expect(vehicle.brand.name).toBe("Royal Motors Renamed");
    expect(vehicle.brandName).toBe("Royal Motors");
  });

  it("blocks deleting a brand that still has vehicles (ON DELETE RESTRICT)", async () => {
    const brandId = await createBrand();
    await createVehicle(brandId);
    const caught = await capture(() =>
      client().brand.delete({ where: { id: brandId } }),
    );
    expect(postgresErrorCode(caught)).toBe("23503");
    expect(describeDatabaseError(caught)).toContain("vehicles_brand_id_fkey");
  });
});

describe("vehicle_images constraints", () => {
  function imageInput(
    vehicleId: string,
    over: { sortOrder: number; isCover?: boolean; publicId?: string },
  ) {
    return {
      vehicleId,
      publicId: over.publicId ?? `fake/${over.sortOrder}`,
      secureUrl: `https://cdn.fake.example/${over.sortOrder}.jpg`,
      width: 1200,
      height: 800,
      format: "jpg",
      byteSize: 12345,
      sortOrder: over.sortOrder,
      ...(over.isCover !== undefined ? { isCover: over.isCover } : {}),
    };
  }

  it("allows one cover plus many non-cover images", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 0, isCover: true }),
    });
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 1, isCover: false }),
    });
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 2, isCover: false }),
    });
    const count = await client().vehicleImage.count({ where: { vehicleId } });
    expect(count).toBe(3);
  });

  it("rejects a second cover image for the same vehicle (partial unique index)", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 0, isCover: true }),
    });
    const caught = await capture(() =>
      client().vehicleImage.create({
        data: imageInput(vehicleId, { sortOrder: 1, isCover: true }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23505");
    expect(describeDatabaseError(caught)).toContain(
      "vehicle_images_one_cover_per_vehicle_idx",
    );
  });

  it("rejects duplicate (vehicle_id, sort_order) in immediate mode", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 0 }),
    });
    const caught = await capture(() =>
      client().vehicleImage.create({
        data: imageInput(vehicleId, { sortOrder: 0, publicId: "fake/dup" }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23505");
    expect(describeDatabaseError(caught)).toContain(
      "vehicle_images_vehicle_id_sort_order_key",
    );
  });

  it("permits a whole-gallery swap inside one deferred transaction", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const a = await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 0, publicId: "fake/a" }),
    });
    const b = await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 1, publicId: "fake/b" }),
    });

    // With the DEFERRABLE constraint deferred, the transient collision (both at
    // the same sort_order mid-transaction) is only checked at COMMIT, so the
    // swap succeeds. Without deferral this would fail on the first UPDATE.
    await client().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
      await tx.vehicleImage.update({
        where: { id: a.id },
        data: { sortOrder: 1 },
      });
      await tx.vehicleImage.update({
        where: { id: b.id },
        data: { sortOrder: 0 },
      });
    });

    const reloadedA = await client().vehicleImage.findUniqueOrThrow({
      where: { id: a.id },
    });
    const reloadedB = await client().vehicleImage.findUniqueOrThrow({
      where: { id: b.id },
    });
    expect(reloadedA.sortOrder).toBe(1);
    expect(reloadedB.sortOrder).toBe(0);
  });

  it("cascades image deletion when the vehicle is deleted", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    await client().vehicleImage.create({
      data: imageInput(vehicleId, { sortOrder: 0, isCover: true }),
    });
    await client().vehicle.delete({ where: { id: vehicleId } });
    const remaining = await client().vehicleImage.count({
      where: { vehicleId },
    });
    expect(remaining).toBe(0);
  });
});

describe("inquiry subject and type CHECK constraints", () => {
  function inquiryInput(over: {
    reference: string;
    type: "purchase" | "viewing";
    vehicleId?: string | null;
    packageId?: string | null;
    preferredViewingAt?: Date | null;
  }) {
    return {
      reference: over.reference,
      type: over.type,
      subjectSnapshot: { model: "FakeModel" },
      customerName: "Fake Customer",
      customerPhone: "+255700000000",
      ...(over.vehicleId !== undefined ? { vehicleId: over.vehicleId } : {}),
      ...(over.packageId !== undefined ? { packageId: over.packageId } : {}),
      ...(over.preferredViewingAt !== undefined
        ? { preferredViewingAt: over.preferredViewingAt }
        : {}),
    };
  }

  it("accepts a valid purchase inquiry (vehicle subject, no viewing time)", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const inquiry = await client().inquiry.create({
      data: inquiryInput({
        reference: "CRR-P-1",
        type: "purchase",
        vehicleId,
      }),
    });
    expect(inquiry.status).toBe("new");
    expect(inquiry.type).toBe("purchase");
  });

  it("accepts a valid viewing inquiry (vehicle subject + viewing time)", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const inquiry = await client().inquiry.create({
      data: inquiryInput({
        reference: "CRR-V-1",
        type: "viewing",
        vehicleId,
        preferredViewingAt: new Date("2026-09-01T09:00:00Z"),
      }),
    });
    expect(inquiry.preferredViewingAt).toBeInstanceOf(Date);
  });

  it("rejects both a vehicle and a package subject", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const caught = await capture(() =>
      client().inquiry.create({
        data: inquiryInput({
          reference: "CRR-X-1",
          type: "viewing",
          vehicleId,
          packageId: "00000000-0000-0000-0000-000000000001",
          preferredViewingAt: new Date("2026-09-01T09:00:00Z"),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "inquiries_subject_exclusive_check",
    );
  });

  it("rejects neither a vehicle nor a package subject", async () => {
    const caught = await capture(() =>
      client().inquiry.create({
        data: inquiryInput({
          reference: "CRR-X-2",
          type: "viewing",
          preferredViewingAt: new Date("2026-09-01T09:00:00Z"),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "inquiries_subject_exclusive_check",
    );
  });

  it("rejects a purchase carrying a viewing-only field", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const caught = await capture(() =>
      client().inquiry.create({
        data: inquiryInput({
          reference: "CRR-X-3",
          type: "purchase",
          vehicleId,
          preferredViewingAt: new Date("2026-09-01T09:00:00Z"),
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "inquiries_purchase_fields_check",
    );
  });

  it("rejects a viewing missing its viewing-specific field", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const caught = await capture(() =>
      client().inquiry.create({
        data: inquiryInput({
          reference: "CRR-X-4",
          type: "viewing",
          vehicleId,
          preferredViewingAt: null,
        }),
      }),
    );
    expect(postgresErrorCode(caught)).toBe("23514");
    expect(describeDatabaseError(caught)).toContain(
      "inquiries_viewing_fields_check",
    );
  });

  it("blocks deleting a vehicle that still has inquiries (ON DELETE RESTRICT)", async () => {
    const brandId = await createBrand();
    const vehicleId = await createVehicle(brandId);
    const inquiry = await client().inquiry.create({
      data: inquiryInput({
        reference: "CRR-P-2",
        type: "purchase",
        vehicleId,
      }),
    });

    // RESTRICT, not SET NULL: nulling the subject would break the exclusivity /
    // purchase-fields CHECKs, so the delete is refused and the inquiry keeps its
    // vehicle subject intact.
    const caught = await capture(() =>
      client().vehicle.delete({ where: { id: vehicleId } }),
    );
    expect(postgresErrorCode(caught)).toBe("23503");
    expect(describeDatabaseError(caught)).toContain(
      "inquiries_vehicle_id_fkey",
    );

    const reloaded = await client().inquiry.findUniqueOrThrow({
      where: { id: inquiry.id },
    });
    expect(reloaded.vehicleId).toBe(vehicleId);
  });
});

interface SearchRow {
  search_text: string;
  matches_brand: boolean;
  matches_model: boolean;
  vector_size: number;
}

describe("generated search columns", () => {
  it("auto-populates search_text and search_vector and matches brand + model", async () => {
    const brandId = await createBrand({ name: "Toyota", slug: "toyota" });
    const vehicleId = await createVehicle(brandId, {
      brandName: "Toyota",
      model: "Land Cruiser",
      slug: "toyota-land-cruiser",
      description: "Well maintained diesel unit",
    });

    // search_text is a plain generated column, readable through the client.
    const vehicle = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(vehicle.searchText).toContain("Toyota");
    expect(vehicle.searchText).toContain("Land Cruiser");

    // search_vector is a tsvector (Unsupported by the client); assert it is
    // populated and that full-text queries match on the denormalized brand name
    // and on the model, all via raw SQL.
    const rows = await client().$queryRawUnsafe<SearchRow[]>(
      `SELECT search_text,
              (search_vector @@ plainto_tsquery('english', 'toyota')) AS matches_brand,
              (search_vector @@ plainto_tsquery('english', 'cruiser')) AS matches_model,
              length(search_vector::text) AS vector_size
       FROM vehicles WHERE id = $1`,
      vehicleId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vector_size).toBeGreaterThan(0);
    expect(rows[0]?.matches_brand).toBe(true);
    expect(rows[0]?.matches_model).toBe(true);
  });

  it("recomputes search_text automatically when the row changes", async () => {
    const brandId = await createBrand({ name: "Nissan", slug: "nissan" });
    const vehicleId = await createVehicle(brandId, {
      brandName: "Nissan",
      model: "Patrol",
      slug: "nissan-patrol",
    });
    await client().vehicle.update({
      where: { id: vehicleId },
      data: { model: "X-Trail" },
    });
    const vehicle = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(vehicle.searchText).toContain("X-Trail");
    expect(vehicle.searchText).not.toContain("Patrol");
  });
});
