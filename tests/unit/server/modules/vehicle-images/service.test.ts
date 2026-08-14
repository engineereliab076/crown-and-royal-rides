import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import type {
  MediaDeletionQueueRepository,
  PendingMediaDeletionRecord,
} from "@/server/modules/media-deletion-queue/repository";
import type { VehicleImageRecord } from "@/server/modules/vehicle-images/dto";
import type {
  CreateVehicleImageRecord,
  VehicleImageRepository,
  VehicleLockRecord,
} from "@/server/modules/vehicle-images/repository";
import { createVehicleImageService } from "@/server/modules/vehicle-images/service";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OWNER: AuthenticatedActor = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner",
};
const MANAGER: AuthenticatedActor = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
  role: "manager",
};

// ── In-memory gallery backing the fake repository ─────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type StoredImage = Mutable<VehicleImageRecord> & { vehicleIdInternal: string };

interface GalleryState {
  vehicles: Map<
    string,
    { updatedAt: Date; slug: string; listingState: string }
  >;
  images: StoredImage[];
  queue: PendingMediaDeletionRecord[];
  clock: number;
  nextQueueId: bigint;
}

interface QueueOptions {
  resolveThrows?: boolean;
  recordFailureThrows?: boolean;
}

function nextStamp(state: GalleryState): Date {
  state.clock += 1000;
  return new Date(state.clock);
}

function strip(image: StoredImage): VehicleImageRecord {
  return {
    id: image.id,
    publicId: image.publicId,
    secureUrl: image.secureUrl,
    width: image.width,
    height: image.height,
    format: image.format,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isCover: image.isCover,
    createdAt: image.createdAt,
  };
}

function createFakeRepository(state: GalleryState): VehicleImageRepository {
  function ordered(vehicleId: string): VehicleImageRecord[] {
    return state.images
      .filter((image) => image.vehicleIdInternal === vehicleId)
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
      .map(strip);
  }
  return {
    async findVehicleTimestamp(vehicleId): Promise<VehicleLockRecord | null> {
      const vehicle = state.vehicles.get(vehicleId);
      return vehicle
        ? {
            id: vehicleId,
            updatedAt: vehicle.updatedAt,
            slug: vehicle.slug,
            listingState: vehicle.listingState,
          }
        : null;
    },
    async lockVehicle(vehicleId): Promise<VehicleLockRecord | null> {
      const vehicle = state.vehicles.get(vehicleId);
      return vehicle
        ? {
            id: vehicleId,
            updatedAt: vehicle.updatedAt,
            slug: vehicle.slug,
            listingState: vehicle.listingState,
          }
        : null;
    },
    async listImages(vehicleId) {
      return ordered(vehicleId);
    },
    async countImages(vehicleId) {
      return state.images.filter((i) => i.vehicleIdInternal === vehicleId)
        .length;
    },
    async findImageByPublicId(publicId) {
      const found = state.images.find((i) => i.publicId === publicId);
      return found ? { id: found.id } : null;
    },
    async createImage(input: CreateVehicleImageRecord) {
      const record: StoredImage = {
        vehicleIdInternal: input.vehicleId,
        id: randomUUID(),
        publicId: input.publicId,
        secureUrl: input.secureUrl,
        width: input.width,
        height: input.height,
        format: input.format,
        altText: input.altText,
        sortOrder: input.sortOrder,
        isCover: input.isCover,
        createdAt: nextStamp(state),
      };
      state.images.push(record);
      return strip(record);
    },
    async replaceSortOrders(orders) {
      for (const order of orders) {
        const image = state.images.find((i) => i.id === order.id);
        if (image) image.sortOrder = order.sortOrder;
      }
    },
    async clearCover(vehicleId) {
      for (const image of state.images) {
        if (image.vehicleIdInternal === vehicleId) image.isCover = false;
      }
    },
    async setCover(imageId) {
      const image = state.images.find((i) => i.id === imageId);
      if (image) image.isCover = true;
    },
    async updateAltText(imageId, altText) {
      const image = state.images.find((i) => i.id === imageId);
      if (!image) throw new Error("missing image");
      image.altText = altText;
      return strip(image);
    },
    async deleteImage(imageId) {
      state.images = state.images.filter((i) => i.id !== imageId);
    },
    async touchVehicle(vehicleId) {
      const vehicle = state.vehicles.get(vehicleId);
      if (!vehicle) throw new Error("missing vehicle");
      vehicle.updatedAt = nextStamp(state);
      return vehicle.updatedAt;
    },
  } as VehicleImageRepository;
}

function createFakeQueue(
  state: GalleryState,
  options: QueueOptions = {},
): MediaDeletionQueueRepository {
  return {
    async enqueue(input) {
      const id = state.nextQueueId++;
      state.queue.push({
        id,
        publicId: input.publicId,
        ownerType: input.ownerType,
        attempts: 0,
        createdAt: nextStamp(state),
        lastAttemptedAt: null,
      });
      return { id };
    },
    async resolve(id) {
      if (options.resolveThrows) throw new Error("queue backend unavailable");
      state.queue = state.queue.filter((entry) => entry.id !== id);
    },
    async listPending(limit) {
      return state.queue.slice(0, limit);
    },
    async recordFailure(id, attemptedAt) {
      if (options.recordFailureThrows) {
        throw new Error("queue backend unavailable");
      }
      const entry = state.queue.find((q) => q.id === id);
      if (entry) {
        state.queue = state.queue.map((q) =>
          q.id === id
            ? { ...q, attempts: q.attempts + 1, lastAttemptedAt: attemptedAt }
            : q,
        );
      }
    },
  };
}

interface Harness {
  service: ReturnType<typeof createVehicleImageService>;
  state: GalleryState;
  storage: InMemoryMediaStorage;
  reporter: InMemoryErrorReporter;
}

function harness(
  options: QueueOptions & { storage?: InMemoryMediaStorage } = {},
): Harness {
  const state: GalleryState = {
    vehicles: new Map([
      [
        VEHICLE_ID,
        {
          updatedAt: new Date(1_000_000),
          slug: "test-vehicle",
          listingState: "draft",
        },
      ],
    ]),
    images: [],
    queue: [],
    clock: 1_000_000,
    nextQueueId: BigInt(1),
  };
  const repository = createFakeRepository(state);
  const queue = createFakeQueue(state, options);
  const storage = options.storage ?? new InMemoryMediaStorage();
  const reporter = new InMemoryErrorReporter();
  const service = createVehicleImageService({
    repository,
    deletionQueue: queue,
    transaction: (operation) =>
      operation({ images: repository, deletionQueue: queue }),
    mediaStorage: () => storage,
    errorReporter: () => reporter,
  });
  return { service, state, storage, reporter };
}

async function registerUpload(
  storage: InMemoryMediaStorage,
  folder = "vehicles",
) {
  const signature = await storage.createUploadSignature({
    folder,
    ownerType: "vehicle",
    ownerId: VEHICLE_ID,
  });
  const resource = {
    publicId: signature.publicId,
    version: 321,
    signature: signature.signature,
    secureUrl: `https://media.test.invalid/${signature.publicId}.jpg`,
    width: 1600,
    height: 900,
    bytes: 245_000,
    format: "jpg",
    resourceType: "image",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  storage.registerExpectedUpload(resource);
  return {
    publicId: resource.publicId,
    version: resource.version,
    signature: resource.signature,
  };
}

async function attachOne(
  h: Harness,
  actor: AuthenticatedActor = OWNER,
  folder = "vehicles",
) {
  const upload = await registerUpload(h.storage, folder);
  return h.service.attach(actor, {
    vehicleId: VEHICLE_ID,
    upload,
    altText: "A meaningful description",
  });
}

function currentStamp(h: Harness): string {
  return (
    h.state.vehicles.get(VEHICLE_ID) as { updatedAt: Date }
  ).updatedAt.toISOString();
}

describe("vehicle image service — authorization", () => {
  it("requires media:manage to list", async () => {
    const h = harness();
    await expect(
      h.service.listForVehicle(
        { id: OWNER.id, role: "stranger" as never },
        { vehicleId: VEHICLE_ID },
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("requires both media:manage and content:manage to mutate", async () => {
    const h = harness();
    const upload = await registerUpload(h.storage);
    await expect(
      h.service.attach(
        { id: OWNER.id, role: "viewer" as never },
        { vehicleId: VEHICLE_ID, upload, altText: "ok" },
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(h.state.images).toHaveLength(0);
  });

  it("allows a manager (who holds both capabilities) to attach", async () => {
    const h = harness();
    const dto = await attachOne(h, MANAGER);
    expect(dto.isCover).toBe(true);
  });
});

describe("vehicle image service — attach", () => {
  it("makes the first attachment the cover at sort order 0", async () => {
    const h = harness();
    const dto = await attachOne(h);
    expect(dto).toMatchObject({ sortOrder: 0, isCover: true });
    expect(JSON.stringify(dto)).not.toContain("publicId");
  });

  it("appends 2–15 with contiguous ordering and a single cover", async () => {
    const h = harness();
    for (let i = 0; i < 15; i += 1) await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    expect(images.map((i) => i.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(images.filter((i) => i.isCover)).toHaveLength(1);
    expect(images[0]?.isCover).toBe(true);
  });

  it("rejects a 16th image and keeps the count at 15", async () => {
    const h = harness();
    for (let i = 0; i < 15; i += 1) await attachOne(h);
    await expect(attachOne(h)).rejects.toMatchObject({
      status: 422,
      code: "VEHICLE_IMAGE_LIMIT_REACHED",
    });
    expect(h.state.images).toHaveLength(15);
  });

  it("rejects a wrong provider namespace before any persistence and cleans up", async () => {
    const h = harness();
    await expect(attachOne(h, OWNER, "other")).rejects.toMatchObject({
      code: "MEDIA_VERIFICATION_FAILED",
    });
    expect(h.state.images).toHaveLength(0);
    expect(
      h.storage.getOperations().some((op) => op.type === "assetDeleted"),
    ).toBe(true);
  });

  it("rejects a duplicate provider asset with a safe conflict", async () => {
    const h = harness();
    const upload = await registerUpload(h.storage);
    await h.service.attach(OWNER, {
      vehicleId: VEHICLE_ID,
      upload,
      altText: "first",
    });
    await expect(
      h.service.attach(OWNER, {
        vehicleId: VEHICLE_ID,
        upload,
        altText: "again",
      }),
    ).rejects.toMatchObject({ status: 409, code: "VEHICLE_IMAGE_DUPLICATE" });
    expect(h.state.images).toHaveLength(1);
  });

  it("rejects a missing vehicle", async () => {
    const h = harness();
    h.state.vehicles.clear();
    await expect(attachOne(h)).rejects.toMatchObject({
      code: "VEHICLE_NOT_FOUND",
    });
  });
});

describe("vehicle image service — reorder", () => {
  it("persists the complete order atomically", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    await attachOne(h);
    const before = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const reversed = [...before].reverse().map((i) => i.id);
    const result = await h.service.reorder(OWNER, {
      vehicleId: VEHICLE_ID,
      imageIds: reversed,
      expectedUpdatedAt: currentStamp(h),
    });
    expect(result.images.map((i) => i.id)).toEqual(reversed);
    expect(result.images.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it("rejects an incomplete set (omission or foreign id)", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    const stamp = currentStamp(h);
    const [first] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    await expect(
      h.service.reorder(OWNER, {
        vehicleId: VEHICLE_ID,
        imageIds: [first!.id],
        expectedUpdatedAt: stamp,
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_IMAGE_SET_MISMATCH" });
    await expect(
      h.service.reorder(OWNER, {
        vehicleId: VEHICLE_ID,
        imageIds: [first!.id, randomUUID()],
        expectedUpdatedAt: stamp,
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_IMAGE_SET_MISMATCH" });
  });

  it("rejects a stale expectedUpdatedAt and changes nothing", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    await expect(
      h.service.reorder(OWNER, {
        vehicleId: VEHICLE_ID,
        imageIds: [...images].reverse().map((i) => i.id),
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE_RECORD" });
    const after = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    expect(after.map((i) => i.id)).toEqual(images.map((i) => i.id));
  });
});

describe("vehicle image service — set cover", () => {
  it("moves the cover to the selected image", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const second = images[1]!;
    const result = await h.service.setCover(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: second.id,
      expectedUpdatedAt: currentStamp(h),
    });
    expect(result.images.filter((i) => i.isCover)).toHaveLength(1);
    expect(result.images.find((i) => i.isCover)?.id).toBe(second.id);
  });

  it("is idempotent for the current cover and does no work", async () => {
    const h = harness();
    await attachOne(h);
    const [cover] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const stampBefore = currentStamp(h);
    const result = await h.service.setCover(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: cover!.id,
      expectedUpdatedAt: stampBefore,
    });
    expect(result.updatedAt).toBe(stampBefore);
    expect(currentStamp(h)).toBe(stampBefore);
    expect(result.images.filter((i) => i.isCover)).toHaveLength(1);
  });

  it("rejects a stale cover change", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    await expect(
      h.service.setCover(OWNER, {
        vehicleId: VEHICLE_ID,
        imageId: images[1]!.id,
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE_RECORD" });
  });
});

describe("vehicle image service — alt text", () => {
  it("persists trimmed alt text and rejects empty text", async () => {
    const h = harness();
    await attachOne(h);
    const [image] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const updated = await h.service.updateAltText(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: image!.id,
      altText: "  New precise description  ",
    });
    expect(updated.altText).toBe("New precise description");
    await expect(
      h.service.updateAltText(OWNER, {
        vehicleId: VEHICLE_ID,
        imageId: image!.id,
        altText: "   ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("vehicle image service — remove", () => {
  it("compacts order when a non-cover image is removed", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const middle = images[1]!;
    const result = await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: middle.id,
    });
    expect(result.images.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(result.images.some((i) => i.id === middle.id)).toBe(false);
    expect(result.images.filter((i) => i.isCover)).toHaveLength(1);
  });

  it("promotes the next image by prior sort order when the cover is removed", async () => {
    const h = harness();
    await attachOne(h);
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const cover = images.find((i) => i.isCover)!;
    const expectedNext = images.filter((i) => i.id !== cover.id)[0]!;
    const result = await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: cover.id,
    });
    expect(result.images.find((i) => i.isCover)?.id).toBe(expectedNext.id);
    expect(result.images.filter((i) => i.isCover)).toHaveLength(1);
  });

  it("leaves zero covers when the final image is removed", async () => {
    const h = harness();
    await attachOne(h);
    const [only] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const result = await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: only!.id,
    });
    expect(result.images).toHaveLength(0);
  });

  it("resolves the deletion queue when the provider delete succeeds", async () => {
    const h = harness();
    await attachOne(h);
    const [image] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: image!.id,
    });
    expect(h.state.queue).toHaveLength(0);
  });

  it("keeps a queue entry and the committed removal when provider delete fails", async () => {
    const storage = new InMemoryMediaStorage({ deleteFails: true });
    const h = harness({ storage });
    await attachOne(h);
    await attachOne(h);
    const images = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const cover = images.find((i) => i.isCover)!;
    const result = await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: cover.id,
    });
    // Database mutation intact: image gone, cover promoted, order compacted.
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.isCover).toBe(true);
    expect(result.images[0]?.sortOrder).toBe(0);
    // A pending queue entry remains for a later retry.
    expect(h.state.queue).toHaveLength(1);
    expect(h.state.queue[0]?.ownerType).toBe("vehicle");
  });

  it("does not leak provider details when queue/reporting fails", async () => {
    const storage = new InMemoryMediaStorage({ deleteFails: true });
    const h = harness({ storage, recordFailureThrows: true });
    await attachOne(h);
    const [image] = await h.service.listForVehicle(OWNER, {
      vehicleId: VEHICLE_ID,
    });
    const publicId = h.state.images[0]!.publicId;
    // Removal still succeeds even though recordFailure throws internally.
    const result = await h.service.remove(OWNER, {
      vehicleId: VEHICLE_ID,
      imageId: image!.id,
    });
    expect(result.images).toHaveLength(0);
    const reported = JSON.stringify(h.reporter.getReports());
    expect(reported).not.toContain(publicId);
    expect(reported).not.toContain("cloudinary");
  });
});
