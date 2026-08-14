import { describe, expect, it } from "vitest";

import {
  toVehicleAdminDTO,
  toVehiclePublicDetailDTO,
} from "@/server/modules/vehicles/dto";
import type { VehicleAdminRecord } from "@/server/modules/vehicles/repository";

function record(
  overrides: Partial<VehicleAdminRecord> = {},
): VehicleAdminRecord {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    brandId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    brandName: "Toyota",
    model: "Land Cruiser",
    slug: "toyota-land-cruiser-2025-abcd1234",
    year: 2025,
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "diesel",
    driverOption: "without_driver",
    listingState: "draft",
    isForSale: true,
    saleStatus: "available",
    salePrice: BigInt(150_000_000),
    description:
      "A complete description that is comfortably over forty characters.",
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    images: [],
    ...overrides,
  };
}

describe("vehicle DTO mappers", () => {
  it("converts BigInt money and is JSON serializable", () => {
    const dto = toVehicleAdminDTO(record());
    expect(typeof dto.salePrice).toBe("number");
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("handles null price and an absent cover safely", () => {
    const dto = toVehicleAdminDTO(
      record({ isForSale: false, saleStatus: null, salePrice: null }),
    );
    expect(dto.salePrice).toBeNull();
    expect(dto.coverImage).toBeNull();
  });

  it("maps trusted stored image dimensions into the safe DTO", () => {
    const dto = toVehiclePublicDetailDTO(
      record({
        images: [
          {
            secureUrl: "https://media.test.invalid/cover.jpg",
            width: 1600,
            height: 900,
            altText: "Vehicle cover",
            isCover: true,
            sortOrder: 0,
          },
        ],
      }),
    );
    expect(dto.coverImage).toMatchObject({ width: 1600, height: 900 });
  });

  it("allow-lists public fields and excludes private/future database fields", () => {
    const source = {
      ...record(),
      registrationNumber: "T 123 ABC",
      chassisNumber: "secret",
      searchVector: BigInt(1),
    };
    const dto = toVehiclePublicDetailDTO(source);
    const serialized = JSON.stringify(dto);
    expect(dto).not.toHaveProperty("brandId");
    expect(dto).not.toHaveProperty("listingState");
    expect(serialized).not.toContain("registrationNumber");
    expect(serialized).not.toContain("chassisNumber");
    expect(serialized).not.toContain("searchVector");
  });
});
