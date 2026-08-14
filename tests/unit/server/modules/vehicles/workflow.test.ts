import { describe, expect, it } from "vitest";

import {
  deriveVehicleBadge,
  getPublicationReadiness,
} from "@/server/modules/vehicles/dto";

const readinessVehicle = {
  brandName: "Toyota",
  model: "Land Cruiser",
  year: 2025,
  bodyType: "suv",
  condition: "foreign_used",
  transmission: "automatic",
  fuelType: "diesel",
  drivetrain: "awd",
  location: "Dar es Salaam",
  description:
    "A complete description that is comfortably more than forty characters.",
  images: [{ isCover: true, altText: "Black Toyota Land Cruiser" }],
  isForSale: true,
  saleStatus: "available",
  salePrice: BigInt(100),
  isForRent: false,
  rentalStatus: null,
  rentalDailyPrice: null,
  minRentalDays: null,
  mileageKm: 50_000,
  driverOption: "without_driver",
  driverNote: null,
  exteriorColor: "Black",
  seats: 5,
} as const;

describe("vehicle publication readiness", () => {
  it("accepts a complete publication candidate", () => {
    expect(getPublicationReadiness(readinessVehicle)).toMatchObject({
      ready: true,
      missing: [],
    });
  });

  it("returns every missing requirement with stable keys and safe labels", () => {
    const result = getPublicationReadiness({
      ...readinessVehicle,
      brandName: "",
      model: "",
      drivetrain: null,
      location: " ",
      description: "short",
      images: [{ isCover: false, altText: "" }],
      isForSale: false,
      saleStatus: null,
      salePrice: null,
      isForRent: true,
      rentalStatus: null,
      rentalDailyPrice: null,
      minRentalDays: null,
      mileageKm: null,
      driverOption: "with_driver",
      driverNote: "",
      exteriorColor: null,
      seats: null,
    });
    expect(result.missing).toEqual([
      "brand",
      "model",
      "drivetrain",
      "location",
      "description",
      "coverImage",
      "imageAltText",
      "rentalStatus",
      "rentalDailyPrice",
      "minRentalDays",
      "mileageKm",
      "driverNote",
      "exteriorColor",
      "seats",
    ]);
    expect(
      result.checklist.every(
        (item) => item.key.length > 0 && item.label.length > 0,
      ),
    ).toBe(true);
  });
});

describe("deriveVehicleBadge truth table", () => {
  const badge = (
    listingState: string,
    saleStatus: string | null,
    rentalStatus: string | null,
    isForSale = saleStatus !== null,
    isForRent = rentalStatus !== null,
  ) =>
    deriveVehicleBadge({
      listingState,
      isForSale,
      saleStatus,
      isForRent,
      rentalStatus,
    });

  it.each([
    ["archived", "available", "available", "archived"],
    ["draft", "available", "available", "draft"],
    ["published", "sold", null, "sold"],
    ["published", null, "rented", "rented"],
    ["published", "reserved", null, "reserved"],
    ["published", null, "reserved", "reserved"],
    ["published", "available", "available", "sale-and-rent"],
    ["published", "available", null, "for-sale"],
    ["published", null, "available", "for-rent"],
    ["published", "sold", "unavailable", "sold"],
  ])("maps %s/%s/%s to %s", (listing, sale, rental, expected) => {
    expect(badge(listing!, sale, rental)).toBe(expected);
  });

  it("handles mixed commercial states by exposing the independently available mode", () => {
    expect(badge("published", "sold", "available")).toBe("for-rent");
    expect(badge("published", "available", "rented")).toBe("for-sale");
    expect(badge("published", "reserved", "available")).toBe("for-rent");
  });
});
