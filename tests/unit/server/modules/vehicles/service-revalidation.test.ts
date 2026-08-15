import { describe, expect, it, vi } from "vitest";

import type {
  VehicleAdminRecord,
  VehicleRepository,
} from "@/server/modules/vehicles/repository";
import { createVehicleService } from "@/server/modules/vehicles/service";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OWNER = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner" as const,
};

function record(
  overrides: Partial<VehicleAdminRecord> = {},
): VehicleAdminRecord {
  return {
    id: VEHICLE_ID,
    brandId: OWNER.id,
    brandName: "Toyota",
    model: "Land Cruiser",
    slug: "toyota-land-cruiser-2025-deadbeef",
    year: 2025,
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "diesel",
    driverOption: "without_driver",
    listingState: "published",
    isForSale: true,
    saleStatus: "available",
    salePrice: BigInt(150_000_000),
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    isNegotiable: false,
    registrationNumber: null,
    chassisNumber: null,
    location: "Dar es Salaam",
    driverNote: null,
    mileageKm: 50_000,
    engineCc: null,
    engineDescription: null,
    seats: 5,
    doors: null,
    exteriorColor: "Black",
    interiorColor: null,
    drivetrain: "awd",
    features: [],
    isFeatured: false,
    featuredAt: null,
    lastVerifiedAt: null,
    description:
      "A complete public description well over the forty character floor.",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    images: [],
    ...overrides,
  };
}

function fakeRepository(
  overrides: Partial<VehicleRepository> = {},
): VehicleRepository {
  return {
    findBrandById: vi.fn().mockResolvedValue({ id: OWNER.id, name: "Toyota" }),
    listBrands: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    findSlug: vi.fn().mockResolvedValue(null),
    getAdminById: vi.fn().mockResolvedValue(record()),
    listAdmin: vi.fn(),
    getPublicBySlug: vi.fn(),
    listFeaturedPublic: vi.fn().mockResolvedValue([]),
    getPublicationCandidate: vi.fn().mockResolvedValue(record()),
    updateDraft: vi.fn().mockResolvedValue(record()),
    updateListingState: vi
      .fn()
      .mockResolvedValue(record({ listingState: "draft" })),
    updateSaleStatus: vi.fn().mockResolvedValue(record({ saleStatus: "sold" })),
    updateRentalStatus: vi.fn().mockResolvedValue(record()),
    setFeatured: vi.fn().mockResolvedValue(record()),
    markVerified: vi.fn().mockResolvedValue(record()),
    countFeatured: vi.fn().mockResolvedValue(0),
    lockVehicle: vi.fn().mockResolvedValue(true),
    lockFeaturedSet: vi.fn().mockResolvedValue(undefined),
    findImageByPublicId: vi.fn().mockResolvedValue(null),
    createCover: vi.fn(),
    publish: vi.fn().mockResolvedValue(record()),
    ...overrides,
  };
}

describe("vehicle service revalidation matrix", () => {
  it("a public specification change on a published vehicle revalidates", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository(),
      revalidateVehicle,
    }).updateDraft(OWNER, VEHICLE_ID, {
      step: "specifications",
      data: { mileageKm: 99_999 },
    });
    expect(revalidateVehicle).toHaveBeenCalledWith(
      "toyota-land-cruiser-2025-deadbeef",
    );
  });

  it("a private-only registration/chassis edit does not revalidate", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository(),
      revalidateVehicle,
    }).updateDraft(OWNER, VEHICLE_ID, {
      step: "specifications",
      data: { registrationNumber: "T 123 ABC", chassisNumber: "JT111" },
    });
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("a specification edit on a draft vehicle does not revalidate", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository({
        getAdminById: vi
          .fn()
          .mockResolvedValue(record({ listingState: "draft" })),
      }),
      revalidateVehicle,
    }).updateDraft(OWNER, VEHICLE_ID, {
      step: "specifications",
      data: { mileageKm: 99_999 },
    });
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("a no-op specification edit (same value) does not revalidate", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository(),
      revalidateVehicle,
    }).updateDraft(OWNER, VEHICLE_ID, {
      step: "specifications",
      data: { mileageKm: 50_000 },
    });
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("verification-only changes never revalidate", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository(),
      revalidateVehicle,
    }).markVerified(OWNER, { vehicleId: VEHICLE_ID });
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("restoring an archived vehicle revalidates to purge its retired page", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi
          .fn()
          .mockResolvedValue(record({ listingState: "archived" })),
      }),
      revalidateVehicle,
    }).transitionVehicle(OWNER, { vehicleId: VEHICLE_ID, action: "restore" });
    expect(revalidateVehicle).toHaveBeenCalledWith(
      "toyota-land-cruiser-2025-deadbeef",
    );
  });

  it("archiving a published vehicle revalidates", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi
          .fn()
          .mockResolvedValue(record({ listingState: "published" })),
      }),
      revalidateVehicle,
    }).transitionVehicle(OWNER, { vehicleId: VEHICLE_ID, action: "archive" });
    expect(revalidateVehicle).toHaveBeenCalled();
  });

  it("archiving a draft vehicle does not revalidate", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi
          .fn()
          .mockResolvedValue(record({ listingState: "draft" })),
      }),
      revalidateVehicle,
    }).transitionVehicle(OWNER, { vehicleId: VEHICLE_ID, action: "archive" });
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("a published sale status change revalidates", async () => {
    const revalidateVehicle = vi.fn();
    await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi.fn().mockResolvedValue(record()),
      }),
      revalidateVehicle,
    }).transitionVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
      action: "sale_sold",
    });
    expect(revalidateVehicle).toHaveBeenCalled();
  });
});
