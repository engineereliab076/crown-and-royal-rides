import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { createPrismaMediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";
import { createMediaDeletionRetryService } from "@/server/modules/media-deletion-queue/retry-service";
import { createPrismaVehicleImageRepository } from "@/server/modules/vehicle-images/repository";
import { createVehicleImageService } from "@/server/modules/vehicle-images/service";

import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Deletion outbox lifecycle against the real disposable database: a removal that
 * fails at the provider leaves a durable queue entry, and the retry worker later
 * resolves it. Also proves batch counts with the real queue repository.
 */

const suite = setupDatabaseSuite();
const OWNER: AuthenticatedActor = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner",
};

function client(): PrismaClient {
  return suite.getClient();
}

function imageService(storage: InMemoryMediaStorage) {
  const db = client();
  return createVehicleImageService({
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
    errorReporter: () => new InMemoryErrorReporter(),
  });
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
      description: "A complete vehicle description for the retry suite.",
    },
  });
  return vehicle.id;
}

async function attach(
  service: ReturnType<typeof imageService>,
  storage: InMemoryMediaStorage,
  vehicleId: string,
) {
  const signature = await storage.createUploadSignature({
    folder: "vehicles",
    ownerType: "vehicle",
    ownerId: vehicleId,
  });
  storage.registerExpectedUpload({
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
  });
  return service.attach(OWNER, {
    vehicleId,
    upload: {
      publicId: signature.publicId,
      version: 500,
      signature: signature.signature,
    },
    altText: "A description",
  });
}

describe("media deletion outbox + retry (real database)", () => {
  it("retains a queue entry on provider failure, then resolves it on retry", async () => {
    const failing = new InMemoryMediaStorage({ deleteFails: true });
    const service = imageService(failing);
    const vehicleId = await seedVehicle();
    const image = await attach(service, failing, vehicleId);

    // Removal commits, provider deletion fails → durable entry remains.
    await service.remove(OWNER, { vehicleId, imageId: image.id });
    expect(await client().vehicleImage.count({ where: { vehicleId } })).toBe(0);
    expect(await client().mediaDeletionQueue.count()).toBe(1);

    // A later retry with a working provider resolves the obligation.
    const working = new InMemoryMediaStorage();
    const retry = createMediaDeletionRetryService({
      repository: createPrismaMediaDeletionQueueRepository(client()),
      mediaStorage: () => working,
    });
    const result = await retry.process();
    expect(result).toMatchObject({ selected: 1, deleted: 1, failed: 0 });
    expect(await client().mediaDeletionQueue.count()).toBe(0);
  });

  it("increments attempts and keeps the entry when retry still fails", async () => {
    const queue = createPrismaMediaDeletionQueueRepository(client());
    await queue.enqueue({
      publicId: "vehicles/vehicle/v/asset-x",
      ownerType: "vehicle",
    });
    const failing = new InMemoryMediaStorage({ deleteFails: true });
    const retry = createMediaDeletionRetryService({
      repository: queue,
      mediaStorage: () => failing,
    });
    const result = await retry.process();
    expect(result).toMatchObject({ selected: 1, deleted: 0, failed: 1 });
    const rows = await client().mediaDeletionQueue.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.lastError).toBe("deletion_retry_failed");
    expect(rows[0]?.lastAttemptedAt).not.toBeNull();
  });
});
