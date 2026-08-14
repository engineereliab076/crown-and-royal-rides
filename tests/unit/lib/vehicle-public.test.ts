import { describe, expect, it } from "vitest";

import { vehiclePublicPresentation } from "@/lib/vehicle-public";
import type { VehiclePublicDetailDTO } from "@/server/modules/vehicles/dto";

function dto(): VehiclePublicDetailDTO {
  return {
    id: "vehicle-id",
    slug: "toyota-land-cruiser-2025-safe",
    brandName: "Toyota",
    model: "Land Cruiser",
    year: 2025,
    saleStatus: "available",
    salePrice: 150_000_000,
    coverImage: {
      id: "img-1",
      url: "https://res.cloudinary.com/demo/image/upload/safe.jpg",
      width: 1600,
      height: 900,
      altText: "Toyota cover",
      isCover: true,
      sortOrder: 0,
    },
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "diesel",
    driverOption: "without_driver",
    isForSale: true,
    description: "A public description with no private values.",
    images: [],
  };
}

describe("public vehicle presentation", () => {
  it("renders formatted sale price, driver option, and verified cover URL", () => {
    expect(vehiclePublicPresentation(dto())).toMatchObject({
      title: "2025 Toyota Land Cruiser",
      price: "TZS 150,000,000",
      driverOption: "Without driver",
      coverUrl: "https://res.cloudinary.com/demo/image/upload/safe.jpg",
    });
  });

  it("contains no provider metadata or private vehicle keys", () => {
    const serialized = JSON.stringify(vehiclePublicPresentation(dto()));
    for (const forbidden of [
      "publicId",
      "signature",
      "apiKey",
      "registration",
      "chassis",
      "searchVector",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
