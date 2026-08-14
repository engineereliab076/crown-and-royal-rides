import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { createPrismaMediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";
import { createPrismaVehicleImageRepository } from "@/server/modules/vehicle-images/repository";
import {
  createVehicleImageService,
  type VehicleImageService,
} from "@/server/modules/vehicle-images/service";

import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Real-PostgreSQL behavior of the vehicle-image gallery service (Phase 4,
 * Group 1). The service is composed exactly as production wires it — real Prisma
 * repositories, one interactive transaction per mutation — but against the
 * guarded disposable test database, with an in-memory media provider. Concurrency
 * scenarios exercise genuine row locking across separate transactions.
 */

const suite = setupDatabaseSuite();

const OWNER: AuthenticatedActor = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner",
};

function client(): PrismaClient {
  return suite.getClient();
}

interface Harness {
  service: VehicleImageService;
  storage: InMemoryMediaStorage;
  reporter: InMemoryErrorReporter;
}

function makeHarness(options: { deleteFails?: boolean } = {}): Harness {
  const db = client();
  const storage = new InMemoryMediaStorage({
    deleteFails: options.deleteFails,
  });
  const reporter = new InMemoryErrorReporter();
  const service = createVehicleImageService({
    repository: createPrismaVehicleImageRepository(db),
    deletionQueue: createPrismaMediaDeletionQueueRepository(db),
    transaction: (operation) =>
      runInTransaction(
        async (tx) =>
          operation({
            images: createPrismaVehicleImageRepository(tx),
            deletionQueue: createPrismaMediaDeletionQueueRepository(tx),
          }),
        undefined,
        db,
      ),
    mediaStorage: () => storage,
    errorReporter: () => reporter,
  });
  return { service, storage, reporter };
}

async function seedVehicle(): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  const brand = await client().brand.create({
    data: { name: `Brand ${unique}`, slug: `brand-${unique}`, sortOrder: 1 },
  });
  const vehicle = await client().vehicle.create({
    data: {
      brandId: brand.id,
      brandName: brand.name,
      model: "Land Cruiser",
      slug: `vehicle-${unique}`,
      year: 2025,
      bodyType: "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "diesel",
      driverOption: "without_driver",
      isForSale: true,
      saleStatus: "available",
      salePrice: BigInt(150_000_000),
      description: "A complete vehicle description for the gallery suite.",
    },
  });
  return vehicle.id;
}

async function registerUpload(
  storage: InMemoryMediaStorage,
  vehicleId: string,
  folder = "vehicles",
) {
  const signature = await storage.createUploadSignature({
    folder,
    ownerType: "vehicle",
    ownerId: vehicleId,
  });
  const resource = {
    publicId: signature.publicId,
    version: 500,
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

async function attach(
  h: Harness,
  vehicleId: string,
  altText = "A description",
) {
  const upload = await registerUpload(h.storage, vehicleId);
  return h.service.attach(OWNER, { vehicleId, upload, altText });
}

async function currentUpdatedAt(vehicleId: string): Promise<string> {
  const vehicle = await client().vehicle.findUniqueOrThrow({
    where: { id: vehicleId },
    select: { updatedAt: true },
  });
  return vehicle.updatedAt.toISOString();
}

function imageIds(images: readonly { id: string }[]): string[] {
  return images.map((image) => image.id);
}

describe("vehicle image gallery — attachment", () => {
  it("makes the first attachment the cover and enforces authorization", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();

    const upload = await registerUpload(h.storage, vehicleId);
    await expect(
      h.service.attach(
        { id: OWNER.id, role: "nobody" as never },
        { vehicleId, upload, altText: "x" },
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await client().vehicleImage.count()).toBe(0);

    const dto = await attach(h, vehicleId);
    expect(dto).toMatchObject({ sortOrder: 0, isCover: true });
    const stored = await client().vehicleImage.findFirstOrThrow({
      where: { vehicleId },
    });
    expect(stored.isCover).toBe(true);
    expect(stored.sortOrder).toBe(0);
  });

  it("appends images 2–15 with contiguous ordering and a single cover", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 15; i += 1) await attach(h, vehicleId);

    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    expect(images.map((image) => image.sortOrder)).toEqual(
      Array.from({ length: 15 }, (_unused, index) => index),
    );
    expect(images.filter((image) => image.isCover)).toHaveLength(1);
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(
      15,
    );
  });

  it("rejects a 16th image and keeps the count at 15", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 15; i += 1) await attach(h, vehicleId);

    await expect(attach(h, vehicleId)).rejects.toMatchObject({
      status: 422,
      code: "VEHICLE_IMAGE_LIMIT_REACHED",
    });
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(
      15,
    );
  });

  it("never leaves 16 images when two attach at the limit concurrently", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 14; i += 1) await attach(h, vehicleId);

    const first = await registerUpload(h.storage, vehicleId);
    const second = await registerUpload(h.storage, vehicleId);
    const results = await Promise.allSettled([
      h.service.attach(OWNER, {
        vehicleId,
        upload: first,
        altText: "concurrent one",
      }),
      h.service.attach(OWNER, {
        vehicleId,
        upload: second,
        altText: "concurrent two",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(
      15,
    );
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    expect(images.map((image) => image.sortOrder)).toEqual(
      Array.from({ length: 15 }, (_unused, index) => index),
    );
    expect(images.filter((image) => image.isCover)).toHaveLength(1);
  });

  it("rejects a wrong provider namespace before any persistence", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    const upload = await registerUpload(h.storage, vehicleId, "other");
    await expect(
      h.service.attach(OWNER, { vehicleId, upload, altText: "bad" }),
    ).rejects.toMatchObject({ code: "MEDIA_VERIFICATION_FAILED" });
    expect(await client().vehicleImage.count()).toBe(0);
  });

  it("rejects a duplicate provider asset with a safe conflict", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    const upload = await registerUpload(h.storage, vehicleId);
    await h.service.attach(OWNER, { vehicleId, upload, altText: "first" });
    await expect(
      h.service.attach(OWNER, { vehicleId, upload, altText: "second" }),
    ).rejects.toMatchObject({ status: 409, code: "VEHICLE_IMAGE_DUPLICATE" });
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(1);
  });
});

describe("vehicle image gallery — reorder", () => {
  it("persists the complete order atomically", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 4; i += 1) await attach(h, vehicleId);
    const before = await h.service.listForVehicle(OWNER, { vehicleId });
    const reversed = imageIds([...before].reverse());

    const result = await h.service.reorder(OWNER, {
      vehicleId,
      imageIds: reversed,
      expectedUpdatedAt: await currentUpdatedAt(vehicleId),
    });
    expect(imageIds(result.images)).toEqual(reversed);
    expect(result.images.map((image) => image.sortOrder)).toEqual([0, 1, 2, 3]);

    const persisted = await h.service.listForVehicle(OWNER, { vehicleId });
    expect(imageIds(persisted)).toEqual(reversed);
  });

  it("rejects duplicates, omissions, and foreign image IDs", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    await attach(h, vehicleId);
    await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    const stamp = await currentUpdatedAt(vehicleId);

    // Omission.
    await expect(
      h.service.reorder(OWNER, {
        vehicleId,
        imageIds: [images[0]!.id],
        expectedUpdatedAt: stamp,
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_IMAGE_SET_MISMATCH" });
    // Foreign ID.
    await expect(
      h.service.reorder(OWNER, {
        vehicleId,
        imageIds: [images[0]!.id, randomUUID()],
        expectedUpdatedAt: stamp,
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_IMAGE_SET_MISMATCH" });
    // Duplicate (rejected by schema).
    await expect(
      h.service.reorder(OWNER, {
        vehicleId,
        imageIds: [images[0]!.id, images[0]!.id],
        expectedUpdatedAt: stamp,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a stale expectedUpdatedAt and changes nothing", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    await attach(h, vehicleId);
    await attach(h, vehicleId);
    const before = await h.service.listForVehicle(OWNER, { vehicleId });

    await expect(
      h.service.reorder(OWNER, {
        vehicleId,
        imageIds: imageIds([...before].reverse()),
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE_RECORD" });

    const after = await h.service.listForVehicle(OWNER, { vehicleId });
    expect(imageIds(after)).toEqual(imageIds(before));
  });
});

describe("vehicle image gallery — cover", () => {
  it("leaves exactly one cover when two setCover calls run concurrently", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 3; i += 1) await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    const stamp = await currentUpdatedAt(vehicleId);

    const results = await Promise.allSettled([
      h.service.setCover(OWNER, {
        vehicleId,
        imageId: images[1]!.id,
        expectedUpdatedAt: stamp,
      }),
      h.service.setCover(OWNER, {
        vehicleId,
        imageId: images[2]!.id,
        expectedUpdatedAt: stamp,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(
      rejected && (rejected as PromiseRejectedResult).reason,
    ).toMatchObject({
      code: "STALE_RECORD",
    });

    const covers = await client().vehicleImage.count({
      where: { vehicleId, isCover: true },
    });
    expect(covers).toBe(1);
  });

  it("is idempotent for the current cover and does no work", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    await attach(h, vehicleId);
    const [cover] = await h.service.listForVehicle(OWNER, { vehicleId });
    const stamp = await currentUpdatedAt(vehicleId);

    const result = await h.service.setCover(OWNER, {
      vehicleId,
      imageId: cover!.id,
      expectedUpdatedAt: stamp,
    });
    expect(result.updatedAt).toBe(stamp);
    expect(await currentUpdatedAt(vehicleId)).toBe(stamp);
    expect(result.images.filter((image) => image.isCover)).toHaveLength(1);
  });

  it("rejects a stale cover change safely", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    await attach(h, vehicleId);
    await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    await expect(
      h.service.setCover(OWNER, {
        vehicleId,
        imageId: images[1]!.id,
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE_RECORD" });
    const covers = await client().vehicleImage.count({
      where: { vehicleId, isCover: true },
    });
    expect(covers).toBe(1);
  });
});

describe("vehicle image gallery — alt text", () => {
  it("persists trimmed alt text and rejects empty text", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    const image = await attach(h, vehicleId);
    const updated = await h.service.updateAltText(OWNER, {
      vehicleId,
      imageId: image.id,
      altText: "  A precise new description  ",
    });
    expect(updated.altText).toBe("A precise new description");
    const stored = await client().vehicleImage.findUniqueOrThrow({
      where: { id: image.id },
    });
    expect(stored.altText).toBe("A precise new description");

    await expect(
      h.service.updateAltText(OWNER, {
        vehicleId,
        imageId: image.id,
        altText: "   ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("vehicle image gallery — removal", () => {
  it("compacts order when a non-cover image is removed", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 3; i += 1) await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });

    const result = await h.service.remove(OWNER, {
      vehicleId,
      imageId: images[1]!.id,
    });
    expect(result.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    expect(result.images.some((image) => image.id === images[1]!.id)).toBe(
      false,
    );
    expect(result.images.filter((image) => image.isCover)).toHaveLength(1);
  });

  it("promotes the next image by prior sort order when the cover is removed", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 3; i += 1) await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    const cover = images.find((image) => image.isCover)!;
    const expectedNext = images.filter((image) => image.id !== cover.id)[0]!;

    const result = await h.service.remove(OWNER, {
      vehicleId,
      imageId: cover.id,
    });
    expect(result.images.find((image) => image.isCover)?.id).toBe(
      expectedNext.id,
    );
    expect(result.images.filter((image) => image.isCover)).toHaveLength(1);
    expect(result.images.map((image) => image.sortOrder)).toEqual([0, 1]);
  });

  it("leaves zero covers when the final image is removed", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    const image = await attach(h, vehicleId);
    const result = await h.service.remove(OWNER, {
      vehicleId,
      imageId: image.id,
    });
    expect(result.images).toHaveLength(0);
    expect(
      await client().vehicleImage.count({
        where: { vehicleId, isCover: true },
      }),
    ).toBe(0);
  });

  it("leaves no queue item when the provider deletion succeeds", async () => {
    const h = makeHarness();
    const vehicleId = await seedVehicle();
    const image = await attach(h, vehicleId);
    await h.service.remove(OWNER, { vehicleId, imageId: image.id });
    expect(await client().mediaDeletionQueue.count()).toBe(0);
  });

  it("keeps the removal and a pending queue entry when the provider deletion fails", async () => {
    const h = makeHarness({ deleteFails: true });
    const vehicleId = await seedVehicle();
    await attach(h, vehicleId);
    await attach(h, vehicleId);
    const images = await h.service.listForVehicle(OWNER, { vehicleId });
    const cover = images.find((image) => image.isCover)!;

    const result = await h.service.remove(OWNER, {
      vehicleId,
      imageId: cover.id,
    });
    // Database mutation intact: cover row deleted, next promoted, order compacted.
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.isCover).toBe(true);
    expect(result.images[0]?.sortOrder).toBe(0);
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(1);
    // The durable deletion obligation survives for a later retry.
    const pending = await client().mediaDeletionQueue.findMany();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ownerType).toBe("vehicle");
    // No provider error text or public ID leaks into the durable record.
    expect(pending[0]?.lastError).not.toContain(cover.url);
    expect(JSON.stringify(h.reporter.getReports())).not.toContain(cover.url);
  });
});
