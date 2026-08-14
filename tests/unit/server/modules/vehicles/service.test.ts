import { describe, expect, it, vi } from "vitest";

import type { AdminRole } from "@/generated/prisma/enums";
import type {
  VehicleAdminRecord,
  VehicleRepository,
} from "@/server/modules/vehicles/repository";
import { createVehicleService } from "@/server/modules/vehicles/service";

const BRAND_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OWNER = { id: BRAND_ID, role: "owner" as const };
const MANAGER = { id: VEHICLE_ID, role: "manager" as const };
const VALID = {
  brandId: BRAND_ID,
  model: "Land Cruiser",
  year: 2025,
  bodyType: "suv",
  condition: "foreign_used",
  transmission: "automatic",
  fuelType: "diesel",
  driverOption: "without_driver",
  isForSale: true,
  saleStatus: "available",
  salePrice: 150_000_000,
  description:
    "A complete vehicle description with more than forty characters.",
} as const;

function record(
  overrides: Partial<VehicleAdminRecord> = {},
): VehicleAdminRecord {
  return {
    id: VEHICLE_ID,
    brandId: BRAND_ID,
    brandName: "Toyota",
    model: "Land Cruiser",
    slug: "toyota-land-cruiser-2025-deadbeef",
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
    description: VALID.description,
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    images: [],
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<VehicleRepository> = {}) {
  const repository: VehicleRepository = {
    findBrandById: vi
      .fn()
      .mockResolvedValue({ id: BRAND_ID, name: " Toyota " }),
    listBrands: vi.fn().mockResolvedValue([{ id: BRAND_ID, name: "Toyota" }]),
    create: vi.fn().mockImplementation(async (input) =>
      record({
        brandName: input.brandName,
        slug: input.slug,
        salePrice: input.salePrice,
      }),
    ),
    findSlug: vi.fn().mockResolvedValue(null),
    getAdminById: vi.fn().mockResolvedValue(record()),
    listAdmin: vi
      .fn()
      .mockResolvedValue({ items: [record()], page: 1, limit: 20, total: 1 }),
    getPublicBySlug: vi
      .fn()
      .mockResolvedValue(record({ listingState: "published" })),
    getPublicationCandidate: vi.fn().mockResolvedValue(record()),
    findImageByPublicId: vi.fn().mockResolvedValue(null),
    createCover: vi.fn().mockResolvedValue(record()),
    publish: vi
      .fn()
      .mockImplementation(async (_id, publishedAt) =>
        record({ listingState: "published", publishedAt }),
      ),
    ...overrides,
  };
  return repository;
}

function slugCollision() {
  return { code: "P2002", meta: { modelName: "Vehicle", target: ["slug"] } };
}

describe("vehicle service", () => {
  it.each([OWNER, MANAGER])(
    "allows $role actors with content:manage",
    async (actor) => {
      const dto = await createVehicleService({
        repository: fakeRepository(),
        shortId: () => "first-id",
      }).create(actor, VALID);
      expect(dto.brandName).toBe("Toyota");
    },
  );

  it("fails closed with 403 for every admin operation without capability", async () => {
    const service = createVehicleService({ repository: fakeRepository() });
    const actor = { id: OWNER.id, role: "viewer" as AdminRole };
    const operations = [
      () => service.create(actor, VALID),
      () => service.publish(actor, VEHICLE_ID),
      () => service.getAdminById(actor, VEHICLE_ID),
      () => service.listAdmin(actor, {}),
      () => service.listBrands(actor),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
      });
    }
  });

  it("denormalizes the resolved trimmed brand name and converts price after validation", async () => {
    const repository = fakeRepository();
    await createVehicleService({ repository, shortId: () => "safe-id" }).create(
      OWNER,
      VALID,
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: "Toyota",
        salePrice: BigInt(150_000_000),
        slug: "toyota-land-cruiser-2025-safe-id",
      }),
    );
  });

  it("rejects a missing or unusable brand without creating", async () => {
    for (const brand of [null, { id: BRAND_ID, name: "   " }]) {
      const repository = fakeRepository({
        findBrandById: vi.fn().mockResolvedValue(brand),
      });
      await expect(
        createVehicleService({ repository }).create(OWNER, VALID),
      ).rejects.toMatchObject({ status: 422, code: "VEHICLE_BRAND_INVALID" });
      expect(repository.create).not.toHaveBeenCalled();
    }
  });

  it("creates on the first slug attempt", async () => {
    const repository = fakeRepository();
    await createVehicleService({ repository, shortId: () => "first" }).create(
      OWNER,
      VALID,
    );
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("retries one recognized slug collision with a fresh identifier", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.create)
      .mockRejectedValueOnce(slugCollision())
      .mockResolvedValueOnce(
        record({ slug: "toyota-land-cruiser-2025-second" }),
      );
    const ids = ["first", "second"];
    await createVehicleService({
      repository,
      shortId: () => ids.shift() ?? "unused",
    }).create(OWNER, VALID);
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repository.create).mock.calls[1]?.[0].slug).toContain(
      "second",
    );
  });

  it("returns a safe conflict after three slug collisions", async () => {
    const repository = fakeRepository({
      create: vi.fn().mockRejectedValue(slugCollision()),
    });
    await expect(
      createVehicleService({ repository, shortId: () => "collision" }).create(
        OWNER,
        VALID,
      ),
    ).rejects.toMatchObject({ status: 409, code: "VEHICLE_SLUG_CONFLICT" });
    expect(repository.create).toHaveBeenCalledTimes(3);
  });

  it("does not retry unrelated database errors", async () => {
    const failure = new Error("database unavailable");
    const repository = fakeRepository({
      create: vi.fn().mockRejectedValue(failure),
    });
    await expect(
      createVehicleService({ repository }).create(OWNER, VALID),
    ).rejects.toBe(failure);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no image", {}, ["coverImage"]],
    [
      "no cover",
      {
        images: [
          {
            secureUrl: "https://example.test/image.jpg",
            altText: null,
            isCover: false,
            sortOrder: 0,
          },
        ],
      },
      ["coverImage"],
    ],
    [
      "short description",
      {
        images: [
          {
            secureUrl: "https://example.test/image.jpg",
            altText: null,
            isCover: true,
            sortOrder: 0,
          },
        ],
        description: "Too short",
      },
      ["description"],
    ],
    [
      "invalid sale mode",
      {
        images: [
          {
            secureUrl: "https://example.test/image.jpg",
            altText: null,
            isCover: true,
            sortOrder: 0,
          },
        ],
        isForSale: false,
        saleStatus: null,
        salePrice: null,
      },
      ["saleMode", "salePrice"],
    ],
  ])(
    "rejects publication with %s and does not mutate",
    async (_name, overrides, missing) => {
      const repository = fakeRepository({
        getPublicationCandidate: vi
          .fn()
          .mockResolvedValue(record(overrides as Partial<VehicleAdminRecord>)),
      });
      await expect(
        createVehicleService({ repository }).publish(OWNER, VEHICLE_ID),
      ).rejects.toMatchObject({
        status: 422,
        code: "VEHICLE_NOT_READY",
        details: { missing },
      });
      expect(repository.publish).not.toHaveBeenCalled();
    },
  );

  it("publishes a valid candidate and returns JSON-safe money", async () => {
    const candidate = record({
      images: [
        {
          id: "img-cover",
          secureUrl: "https://example.test/cover.jpg",
          width: 1600,
          height: 900,
          altText: "Vehicle",
          isCover: true,
          sortOrder: 0,
        },
      ],
    });
    const repository = fakeRepository({
      getPublicationCandidate: vi.fn().mockResolvedValue(candidate),
    });
    const dto = await createVehicleService({
      repository,
      now: () => new Date("2026-02-01T00:00:00.000Z"),
    }).publish(OWNER, VEHICLE_ID);
    expect(repository.publish).toHaveBeenCalledWith(
      VEHICLE_ID,
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(typeof dto.salePrice).toBe("number");
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("revalidates only after successful first publication", async () => {
    const events: string[] = [];
    const candidate = record({
      images: [
        {
          id: "img-cover",
          secureUrl: "https://example.test/cover.jpg",
          width: 1600,
          height: 900,
          altText: "Vehicle",
          isCover: true,
          sortOrder: 0,
        },
      ],
    });
    const repository = fakeRepository({
      getPublicationCandidate: vi.fn().mockResolvedValue(candidate),
      publish: vi.fn().mockImplementation(async () => {
        events.push("published");
        return record({ listingState: "published" });
      }),
    });
    await createVehicleService({
      repository,
      revalidateVehicle: (slug) => {
        events.push(`revalidated:${slug}`);
      },
    }).publish(OWNER, VEHICLE_ID);
    expect(events).toEqual([
      "published",
      "revalidated:toyota-land-cruiser-2025-deadbeef",
    ]);
  });

  it("never revalidates a failed or idempotent repeat publication", async () => {
    const revalidateVehicle = vi.fn();
    await expect(
      createVehicleService({
        repository: fakeRepository(),
        revalidateVehicle,
      }).publish(OWNER, VEHICLE_ID),
    ).rejects.toMatchObject({ code: "VEHICLE_NOT_READY" });
    expect(revalidateVehicle).not.toHaveBeenCalled();

    const published = record({ listingState: "published" });
    await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi.fn().mockResolvedValue(published),
      }),
      revalidateVehicle,
    }).publish(OWNER, VEHICLE_ID);
    expect(revalidateVehicle).not.toHaveBeenCalled();
  });

  it("does not roll back publication when revalidation fails and reports safely", async () => {
    const candidate = record({
      images: [
        {
          id: "img-cover",
          secureUrl: "https://example.test/cover.jpg",
          width: 1600,
          height: 900,
          altText: "Vehicle",
          isCover: true,
          sortOrder: 0,
        },
      ],
    });
    const reportCacheFailure = vi.fn();
    const dto = await createVehicleService({
      repository: fakeRepository({
        getPublicationCandidate: vi.fn().mockResolvedValue(candidate),
      }),
      revalidateVehicle: vi.fn().mockRejectedValue(new Error("cache marker")),
      reportCacheFailure,
    }).publish(OWNER, VEHICLE_ID, {
      correlationId: "publish-correlation",
      actorId: OWNER.id,
    });
    expect(dto.listingState).toBe("published");
    expect(reportCacheFailure).toHaveBeenCalledWith({
      correlationId: "publish-correlation",
      actorId: OWNER.id,
    });
  });

  it("returns not found when public repository excludes a draft", async () => {
    const repository = fakeRepository({
      getPublicBySlug: vi.fn().mockResolvedValue(null),
    });
    await expect(
      createVehicleService({ repository }).getPublicBySlug("draft-slug"),
    ).rejects.toMatchObject({ status: 404, code: "VEHICLE_NOT_FOUND" });
  });

  it("returns safe not-found for a missing publication candidate", async () => {
    const repository = fakeRepository({
      getPublicationCandidate: vi.fn().mockResolvedValue(null),
    });
    await expect(
      createVehicleService({ repository }).publish(OWNER, VEHICLE_ID),
    ).rejects.toMatchObject({ status: 404 });
  });
});
