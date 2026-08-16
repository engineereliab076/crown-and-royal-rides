import { describe, expect, it } from "vitest";

import {
  catalogueHref,
  parseVehicleFilters,
  serializeCatalogueState,
} from "@/lib/vehicle-filters";
import {
  catalogueMetadata,
  vehicleDetailMetadata,
} from "@/lib/public-metadata";
import { resolveVehiclePublicState } from "@/lib/vehicle-public-state";
import type {
  PublicVehicleDetail,
  PublicVehicleDetailResult,
} from "@/server/modules/vehicles/public-dto";

function detail(): PublicVehicleDetail {
  return {
    id: "public-id",
    slug: "toyota-rav4-2025-safe",
    brandName: "Toyota",
    model: "RAV4",
    year: 2025,
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "petrol",
    driverOption: "without_driver",
    driverNote: null,
    isForSale: true,
    saleStatus: "available",
    salePrice: 90_000_000,
    isNegotiable: false,
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    location: "Dar es Salaam",
    mileageKm: 20_000,
    engineCc: 2000,
    engineDescription: null,
    seats: 5,
    doors: 5,
    exteriorColor: "White",
    interiorColor: "Black",
    drivetrain: "awd",
    features: [],
    isFeatured: false,
    description: "A safe public description.",
    coverImage: {
      id: "image-id",
      url: "https://res.cloudinary.com/demo/image/upload/car.jpg",
      width: 1600,
      height: 900,
      altText: "White Toyota RAV4",
      isCover: true,
      sortOrder: 0,
    },
    images: [],
  };
}

describe("catalogue URL and metadata policy", () => {
  it("serializes normalized state in deterministic order and removes defaults", () => {
    const parsed = parseVehicleFilters(
      { page: "1", sort: "newest", fuelType: "diesel", q: "  Land   Cruiser " },
      "sale",
    );
    expect(serializeCatalogueState(parsed)).toBe(
      "q=Land+Cruiser&fuelType=diesel",
    );
    expect(catalogueHref("/cars-for-sale", parsed)).toBe(
      "/cars-for-sale?q=Land+Cruiser&fuelType=diesel",
    );
  });

  it("drops ignored values from canonical URLs and noindexes effective states", () => {
    const parsed = parseVehicleFilters(
      { unknown: "attacker", brand: "TOYOTA", page: "2", sort: "price_asc" },
      "sale",
    );
    const metadata = catalogueMetadata({
      path: "/cars-for-sale",
      title: "Sale",
      description: "Sale vehicles",
      parsed,
    });
    expect(String(metadata.alternates?.canonical)).toBe(
      "http://localhost:3000/cars-for-sale?brand=toyota&sort=price_asc&page=2",
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.description).toBe("Sale vehicles");
  });

  it("indexes only the clean base and noindexes page two", () => {
    const clean = catalogueMetadata({
      path: "/cars",
      title: "Cars",
      description: "Cars",
      parsed: parseVehicleFilters({ page: "1", sort: "newest" }, "all"),
    });
    const pageTwo = catalogueMetadata({
      path: "/cars",
      title: "Cars",
      description: "Cars",
      parsed: parseVehicleFilters({ page: "2" }, "all"),
    });
    expect(String(clean.alternates?.canonical)).toBe(
      "http://localhost:3000/cars",
    );
    expect(clean.robots).toMatchObject({ index: true, follow: true });
    expect(String(pageTwo.alternates?.canonical)).toBe(
      "http://localhost:3000/cars?page=2",
    );
    expect(pageTwo.robots).toMatchObject({ index: false, follow: true });
    expect(clean.description).toBe("Cars");
    expect(pageTwo.description).toBe("Cars");
  });

  it("maps centralized detail robots and the safe cover into Open Graph", () => {
    const vehicle = detail();
    const presentation = resolveVehiclePublicState({
      listingState: "published",
      isForSale: true,
      saleStatus: "available",
      salePrice: vehicle.salePrice,
      isForRent: false,
      rentalStatus: null,
      rentalDailyPrice: null,
      minRentalDays: null,
    });
    const result: PublicVehicleDetailResult = {
      vehicle,
      presentation,
      related: [],
      robots: presentation.robots,
    };
    const metadata = vehicleDetailMetadata(result);
    expect(metadata.description).toBe("A safe public description.");
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: vehicle.coverImage?.url,
        width: 1600,
        height: 900,
        alt: "White Toyota RAV4",
      }),
    ]);
  });

  it("builds a non-empty detail description only from the public DTO", () => {
    const vehicle = { ...detail(), description: "   " };
    const presentation = resolveVehiclePublicState({
      listingState: "published",
      isForSale: true,
      saleStatus: "available",
      salePrice: vehicle.salePrice,
      isForRent: false,
      rentalStatus: null,
      rentalDailyPrice: null,
      minRentalDays: null,
    });
    const metadata = vehicleDetailMetadata({
      vehicle,
      presentation,
      related: [],
      robots: presentation.robots,
    });

    expect(metadata.description).toBe(
      "2025 Toyota RAV4 from Crown and Royal Rides.",
    );
    expect(metadata.description).not.toMatch(/registration|chassis|publicId/i);
  });
});
