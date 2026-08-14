import { describe, expect, it } from "vitest";

import { createVehicleSchema } from "@/server/modules/vehicles/schemas";

const VALID = {
  brandId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  model: " Land Cruiser ",
  year: 2025,
  bodyType: "suv",
  condition: "foreign_used",
  transmission: "automatic",
  fuelType: "diesel",
  driverOption: "without_driver",
  isForSale: true,
  saleStatus: "available",
  salePrice: 150_000_000,
  description: "Short draft copy is allowed.",
} as const;

describe("vehicle schemas", () => {
  it("accepts a valid draft and trims text", () => {
    const parsed = createVehicleSchema.parse(VALID);
    expect(parsed.model).toBe("Land Cruiser");
  });

  it.each([1980, 2100])("accepts the year boundary %i", (year) => {
    expect(createVehicleSchema.safeParse({ ...VALID, year }).success).toBe(
      true,
    );
  });

  it.each([1979, 2101])("rejects the year outside the boundary %i", (year) => {
    expect(createVehicleSchema.safeParse({ ...VALID, year }).success).toBe(
      false,
    );
  });

  it("rejects invalid enums and server-controlled or unknown keys", () => {
    expect(
      createVehicleSchema.safeParse({ ...VALID, bodyType: "motorcycle" })
        .success,
    ).toBe(false);
    for (const key of [
      "slug",
      "brandName",
      "listingState",
      "publishedAt",
      "id",
      "images",
      "searchText",
    ]) {
      expect(
        createVehicleSchema.safeParse({ ...VALID, [key]: "forbidden" }).success,
      ).toBe(false);
    }
  });

  it("enforces sale-mode consistency", () => {
    expect(
      createVehicleSchema.safeParse({ ...VALID, saleStatus: undefined })
        .success,
    ).toBe(false);
    expect(
      createVehicleSchema.safeParse({
        ...VALID,
        isForSale: false,
        saleStatus: null,
        salePrice: null,
      }).success,
    ).toBe(true);
    expect(
      createVehicleSchema.safeParse({ ...VALID, isForSale: false }).success,
    ).toBe(false);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid price %s",
    (salePrice) => {
      expect(
        createVehicleSchema.safeParse({ ...VALID, salePrice }).success,
      ).toBe(false);
    },
  );
});
