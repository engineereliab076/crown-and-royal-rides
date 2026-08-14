import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { describeDatabaseError, postgresErrorCode } from "../support/errors";
import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();
function client(): PrismaClient {
  return suite.getClient();
}

async function seedVehicle(slug = "phase5-vehicle") {
  const brand = await client().brand.create({
    data: { name: `Brand ${slug}`, slug: `brand-${slug}`, sortOrder: 1 },
  });
  return client().vehicle.create({
    data: {
      brandId: brand.id,
      brandName: brand.name,
      model: "Model",
      slug,
      year: 2020,
      bodyType: "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "petrol",
      driverOption: "without_driver",
    },
  });
}

async function rejected(operation: () => Promise<unknown>, constraint: string) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(postgresErrorCode(error)).toBe("23514");
  expect(describeDatabaseError(error)).toContain(constraint);
}

describe("0005 vehicle workflow constraints", () => {
  it("enforces rental groups and positive daily pricing", async () => {
    const vehicle = await seedVehicle();
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: { isForRent: true },
        }),
      "vehicles_rental_enabled_fields_check",
    );
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: {
            rentalStatus: "available",
            rentalDailyPrice: BigInt(1),
            minRentalDays: 1,
          },
        }),
      "vehicles_rental_disabled_null_check",
    );
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: {
            isForRent: true,
            rentalStatus: "available",
            rentalDailyPrice: BigInt(0),
            minRentalDays: 1,
          },
        }),
      "vehicles_rental_daily_price_positive_check",
    );
  });

  it.each([
    ["minRentalDays", 366, "vehicles_min_rental_days_range_check"],
    ["mileageKm", 2_000_001, "vehicles_mileage_km_range_check"],
    ["engineCc", 10_001, "vehicles_engine_cc_range_check"],
    ["seats", 61, "vehicles_seats_range_check"],
    ["doors", 9, "vehicles_doors_range_check"],
  ] as const)("rejects out-of-range %s", async (field, value, constraint) => {
    const vehicle = await seedVehicle();
    const data =
      field === "minRentalDays"
        ? {
            isForRent: true,
            rentalStatus: "available" as const,
            rentalDailyPrice: BigInt(1),
            minRentalDays: value,
          }
        : { [field]: value };
    await rejected(
      () => client().vehicle.update({ where: { id: vehicle.id }, data }),
      constraint,
    );
  });

  it.each([
    ["driverNote", 501, "vehicles_driver_note_length_check"],
    ["engineDescription", 121, "vehicles_engine_description_length_check"],
    ["exteriorColor", 41, "vehicles_exterior_color_length_check"],
    ["interiorColor", 41, "vehicles_interior_color_length_check"],
  ] as const)("rejects overlong %s", async (field, length, constraint) => {
    const vehicle = await seedVehicle();
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: { [field]: "x".repeat(length) },
        }),
      constraint,
    );
  });

  it("limits feature count and enforces featured timestamp consistency", async () => {
    const vehicle = await seedVehicle();
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: {
            features: Array.from({ length: 51 }, (_, index) => `f${index}`),
          },
        }),
      "vehicles_features_count_check",
    );
    await rejected(
      () =>
        client().vehicle.update({
          where: { id: vehicle.id },
          data: { isFeatured: true },
        }),
      "vehicles_featured_consistency_check",
    );
  });

  it.each(["registrationNumber", "chassisNumber"] as const)(
    "uniquely indexes non-null %s",
    async (field) => {
      const first = await seedVehicle("phase5-first");
      const second = await seedVehicle("phase5-second");
      await client().vehicle.update({
        where: { id: first.id },
        data: { [field]: "CANONICAL-1" },
      });
      let error: unknown;
      try {
        await client().vehicle.update({
          where: { id: second.id },
          data: { [field]: "CANONICAL-1" },
        });
      } catch (caught) {
        error = caught;
      }
      expect(postgresErrorCode(error)).toBe("23505");
      expect(describeDatabaseError(error)).toContain(
        field === "registrationNumber"
          ? "vehicles_registration_number_key"
          : "vehicles_chassis_number_key",
      );
    },
  );
});
