import { describe, expect, it } from "vitest";

import {
  resolveDetailRecordPresentation,
  toPublicVehicleCard,
  toPublicVehicleDetail,
} from "@/server/modules/vehicles/public-dto";
import type {
  VehiclePublicCardRecord,
  VehiclePublicDetailRecord,
} from "@/server/modules/vehicles/public-repository";

function cardRecord(
  overrides: Partial<VehiclePublicCardRecord> = {},
): VehiclePublicCardRecord {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    slug: "toyota-land-cruiser-2025-abcd",
    brandName: "Toyota",
    model: "Land Cruiser",
    year: 2025,
    listingState: "published",
    driverOption: "without_driver",
    isForSale: true,
    saleStatus: "available",
    salePrice: BigInt(150_000_000),
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    location: "Dar es Salaam",
    isFeatured: false,
    images: [
      {
        id: "img-1",
        secureUrl: "https://res.cloudinary.com/demo/image/upload/cover.jpg",
        width: 1600,
        height: 900,
        altText: "Toyota cover",
        isCover: true,
        sortOrder: 0,
      },
    ],
    ...overrides,
  } as VehiclePublicCardRecord;
}

function detailRecord(
  overrides: Partial<VehiclePublicDetailRecord> = {},
): VehiclePublicDetailRecord {
  return {
    ...cardRecord(),
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "diesel",
    driverNote: null,
    isNegotiable: false,
    mileageKm: 50_000,
    engineCc: 4500,
    engineDescription: "V8",
    seats: 7,
    doors: 5,
    exteriorColor: "Black",
    interiorColor: "Beige",
    drivetrain: "awd",
    features: ["Sunroof", "Leather"],
    description: "A safe public description with no private values.",
    ...overrides,
  } as VehiclePublicDetailRecord;
}

const FORBIDDEN_KEYS = [
  "registrationNumber",
  "chassisNumber",
  "publicId",
  "searchVector",
  "searchText",
  "lastVerifiedAt",
  "updatedById",
];

describe("public catalogue DTO mappers", () => {
  it("card money is a JSON-safe number and the DTO serializes", () => {
    const card = toPublicVehicleCard(cardRecord());
    expect(typeof card.salePrice).toBe("number");
    expect(card.salePrice).toBe(150_000_000);
    expect(() => JSON.stringify(card)).not.toThrow();
  });

  it("card embeds the centralized presentation state", () => {
    const card = toPublicVehicleCard(cardRecord());
    expect(card.presentation.badge).toBe("for-sale");
    expect(card.presentation.saleActionable).toBe(true);
  });

  it("every card image carries non-empty alt text with a safe fallback", () => {
    const withAlt = toPublicVehicleCard(cardRecord());
    expect(withAlt.coverImage?.altText).toBe("Toyota cover");

    const missing = toPublicVehicleCard(
      cardRecord({
        images: [
          {
            id: "img-2",
            secureUrl: "https://res.cloudinary.com/demo/image/upload/x.jpg",
            width: 1600,
            height: 900,
            altText: "   ",
            isCover: true,
            sortOrder: 0,
          },
        ],
      }),
    );
    expect(missing.coverImage?.altText).toBe("2025 Toyota Land Cruiser");
  });

  it("card DTO omits private and listing-state fields", () => {
    const card = toPublicVehicleCard(cardRecord());
    expect(card).not.toHaveProperty("listingState");
    const serialized = JSON.stringify(card);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(key);
    }
  });

  it("detail money is numeric, serializes, and images all have alt text", () => {
    const detail = toPublicVehicleDetail(
      detailRecord({
        isForRent: true,
        rentalStatus: "available",
        rentalDailyPrice: BigInt(250_000),
        minRentalDays: 2,
        images: [
          {
            id: "a",
            secureUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg",
            width: 1600,
            height: 900,
            altText: null,
            isCover: true,
            sortOrder: 0,
          },
          {
            id: "b",
            secureUrl: "https://res.cloudinary.com/demo/image/upload/b.jpg",
            width: 1600,
            height: 900,
            altText: "Second",
            isCover: false,
            sortOrder: 1,
          },
        ],
      }),
    );
    expect(typeof detail.salePrice).toBe("number");
    expect(detail.rentalDailyPrice).toBe(250_000);
    expect(
      detail.images.every((image) => image.altText.trim().length > 0),
    ).toBe(true);
    expect(() => JSON.stringify(detail)).not.toThrow();
  });

  it("detail DTO never exposes private identifiers even if present on the record", () => {
    const detail = toPublicVehicleDetail(
      detailRecord({
        // Simulate accidental extra columns to prove the mapper allow-lists.
        ...({
          registrationNumber: "T 123 ABC",
          chassisNumber: "SECRET",
        } as unknown as object),
      } as VehiclePublicDetailRecord),
    );
    const serialized = JSON.stringify(detail);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain("T 123 ABC");
    expect(serialized).not.toContain("SECRET");
  });

  it("resolves an archived detail record to the retired state", () => {
    const state = resolveDetailRecordPresentation(
      detailRecord({ listingState: "archived" }),
    );
    expect(state.state).toBe("retired");
    expect(state.robots).toEqual({ index: false, follow: false });
  });
});
