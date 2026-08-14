import { describe, expect, it, vi } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import {
  InMemoryMediaStorage,
  type InMemoryRegisteredUpload,
} from "@/server/integrations/media-storage/in-memory";
import type { UploadSignature } from "@/server/integrations/media-storage/types";
import { createVehicleMediaService } from "@/server/modules/vehicles/media-service";
import type {
  VehicleAdminRecord,
  VehicleRepository,
} from "@/server/modules/vehicles/repository";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const ACTOR = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "manager" as const,
};
const CONTEXT = { correlationId: "cover-correlation", actorId: ACTOR.id };

function record(
  overrides: Partial<VehicleAdminRecord> = {},
): VehicleAdminRecord {
  return {
    id: VEHICLE_ID,
    brandId: ACTOR.id,
    brandName: "Toyota",
    model: "Land Cruiser",
    slug: "toyota-land-cruiser-2025-cover",
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
      "A description that is comfortably longer than forty characters.",
    publishedAt: null,
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
    findBrandById: vi.fn().mockResolvedValue(null),
    listBrands: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(record()),
    findSlug: vi.fn().mockResolvedValue(null),
    getAdminById: vi.fn().mockResolvedValue(record()),
    listAdmin: vi
      .fn()
      .mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 }),
    getPublicBySlug: vi.fn().mockResolvedValue(null),
    getPublicationCandidate: vi.fn().mockResolvedValue(record()),
    findImageByPublicId: vi.fn().mockResolvedValue(null),
    createCover: vi.fn().mockImplementation(async (_vehicleId, image) =>
      record({
        images: [
          {
            secureUrl: image.secureUrl,
            width: image.width,
            height: image.height,
            altText: image.altText,
            isCover: true,
            sortOrder: 0,
          },
        ],
      }),
    ),
    publish: vi.fn().mockResolvedValue(record()),
    ...overrides,
  };
}

function registered(
  signature: UploadSignature,
  overrides: Partial<InMemoryRegisteredUpload> = {},
): InMemoryRegisteredUpload {
  return {
    publicId: signature.publicId,
    version: 123,
    signature: signature.signature,
    secureUrl: `https://media.test.invalid/${signature.publicId}.jpg`,
    width: 1600,
    height: 900,
    bytes: 245_000,
    format: "jpg",
    resourceType: "image",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function arranged(storage: InMemoryMediaStorage) {
  const authorization = await storage.createUploadSignature({
    folder: "vehicles",
    ownerType: "vehicle",
    ownerId: VEHICLE_ID,
  });
  const resource = registered(authorization);
  storage.registerExpectedUpload(resource);
  return {
    resource,
    completed: {
      publicId: resource.publicId,
      version: resource.version,
      signature: resource.signature,
    },
  };
}

function service(
  repository: VehicleRepository,
  storage: InMemoryMediaStorage,
  reporter = new InMemoryErrorReporter(),
) {
  return {
    service: createVehicleMediaService({
      repository,
      mediaStorage: () => storage,
      errorReporter: () => reporter,
    }),
    reporter,
  };
}

describe("vehicle media service", () => {
  it("issues a constrained safe authorization only after target lookup", async () => {
    const repository = fakeRepository();
    const storage = new InMemoryMediaStorage({ now: () => 1000 });
    const authorization = await service(
      repository,
      storage,
    ).service.createCoverUploadAuthorization(ACTOR, VEHICLE_ID);
    expect(repository.getAdminById).toHaveBeenCalledWith(VEHICLE_ID);
    expect(authorization).toMatchObject({
      folder: `vehicles/vehicle/${VEHICLE_ID}`,
      resourceType: "image",
      allowedFormats: ["jpg", "jpeg", "png", "webp"],
      maxBytes: 10 * 1024 * 1024,
    });
    expect(JSON.stringify(authorization)).not.toContain("secret");
  });

  it("requires both media and content capabilities", async () => {
    const storage = new InMemoryMediaStorage();
    const operation = service(
      fakeRepository(),
      storage,
    ).service.createCoverUploadAuthorization(
      { id: ACTOR.id, role: "viewer" as never },
      VEHICLE_ID,
    );
    await expect(operation).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("persists only trusted verified metadata as the single sort-zero cover", async () => {
    const repository = fakeRepository();
    const storage = new InMemoryMediaStorage();
    const upload = await arranged(storage);
    const dto = await service(repository, storage).service.attachCover(
      ACTOR,
      VEHICLE_ID,
      upload.completed,
      CONTEXT,
    );
    expect(repository.createCover).toHaveBeenCalledWith(VEHICLE_ID, {
      publicId: upload.resource.publicId,
      secureUrl: upload.resource.secureUrl,
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 245_000,
      altText: "Toyota Land Cruiser cover image",
    });
    expect(dto.coverImage?.url).toBe(upload.resource.secureUrl);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("rejects nonexistent vehicles and an existing cover with safe errors", async () => {
    for (const [vehicle, code] of [
      [null, "VEHICLE_NOT_FOUND"],
      [
        record({
          images: [
            {
              secureUrl: "https://media.test.invalid/existing.jpg",
              width: 1600,
              height: 900,
              altText: null,
              isCover: true,
              sortOrder: 0,
            },
          ],
        }),
        "VEHICLE_COVER_EXISTS",
      ],
    ] as const) {
      const repository = fakeRepository({
        getAdminById: vi.fn().mockResolvedValue(vehicle),
      });
      const storage = new InMemoryMediaStorage();
      const upload = await arranged(storage);
      await expect(
        service(repository, storage).service.attachCover(
          ACTOR,
          VEHICLE_ID,
          upload.completed,
          CONTEXT,
        ),
      ).rejects.toMatchObject({ code });
      expect(repository.createCover).not.toHaveBeenCalled();
    }
  });

  it("rejects tampered and wrong-folder resources before database write", async () => {
    const repository = fakeRepository();
    const storage = new InMemoryMediaStorage();
    const upload = await arranged(storage);
    await expect(
      service(repository, storage).service.attachCover(
        ACTOR,
        VEHICLE_ID,
        { ...upload.completed, signature: "tampered" },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: "MEDIA_VERIFICATION_FAILED" });
    expect(repository.createCover).not.toHaveBeenCalled();

    const wrongStorage = new InMemoryMediaStorage();
    const authorization = await wrongStorage.createUploadSignature({
      folder: "other",
      ownerType: "vehicle",
      ownerId: VEHICLE_ID,
    });
    const wrong = registered(authorization);
    wrongStorage.registerExpectedUpload(wrong);
    await expect(
      service(repository, wrongStorage).service.attachCover(
        ACTOR,
        VEHICLE_ID,
        {
          publicId: wrong.publicId,
          version: wrong.version,
          signature: wrong.signature,
        },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: "MEDIA_VERIFICATION_FAILED" });
    expect(repository.createCover).not.toHaveBeenCalled();
  });

  it("translates duplicate races and cleans up a proven orphan", async () => {
    const repository = fakeRepository({
      createCover: vi.fn().mockRejectedValue({
        code: "P2002",
        meta: { modelName: "VehicleImage" },
      }),
    });
    const storage = new InMemoryMediaStorage();
    const upload = await arranged(storage);
    await expect(
      service(repository, storage).service.attachCover(
        ACTOR,
        VEHICLE_ID,
        upload.completed,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ status: 409, code: "VEHICLE_COVER_EXISTS" });
    expect(storage.getOperations()).toContainEqual({
      type: "assetDeleted",
      publicId: upload.resource.publicId,
      outcome: "deleted",
    });
  });

  it("reports cleanup failure without replacing the original database error", async () => {
    const repository = fakeRepository({
      createCover: vi.fn().mockRejectedValue(new Error("database marker")),
    });
    const storage = new InMemoryMediaStorage({ deleteFails: true });
    const upload = await arranged(storage);
    const harness = service(repository, storage);
    await expect(
      harness.service.attachCover(ACTOR, VEHICLE_ID, upload.completed, CONTEXT),
    ).rejects.toMatchObject({ code: "VEHICLE_COVER_ATTACH_FAILED" });
    expect(harness.reporter.getReports()).toMatchObject([
      { type: "message", message: "Vehicle cover orphan cleanup failed." },
    ]);
    expect(JSON.stringify(harness.reporter.getReports())).not.toContain(
      "database marker",
    );
  });

  it("does not delete when the asset is attached or orphan status is inconclusive", async () => {
    for (const findImageByPublicId of [
      vi.fn().mockResolvedValue({ id: "image-id" }),
      vi.fn().mockRejectedValue(new Error("database unavailable")),
    ]) {
      const repository = fakeRepository({
        createCover: vi.fn().mockRejectedValue(new Error("failure")),
        findImageByPublicId,
      });
      const storage = new InMemoryMediaStorage();
      const upload = await arranged(storage);
      await expect(
        service(repository, storage).service.attachCover(
          ACTOR,
          VEHICLE_ID,
          upload.completed,
          CONTEXT,
        ),
      ).rejects.toMatchObject({ code: "VEHICLE_COVER_ATTACH_FAILED" });
      expect(
        storage
          .getOperations()
          .some((operation) => operation.type === "assetDeleted"),
      ).toBe(false);
    }
  });
});
