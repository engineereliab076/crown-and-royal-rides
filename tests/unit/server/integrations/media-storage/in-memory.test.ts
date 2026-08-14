import { describe, expect, it } from "vitest";

import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import type { InMemoryRegisteredUpload } from "@/server/integrations/media-storage/in-memory";
import type {
  UploadResult,
  UploadSignature,
} from "@/server/integrations/media-storage/types";
import { runMediaStorageContract } from "./contract";

function resultFor(signature: UploadSignature): InMemoryRegisteredUpload {
  return {
    publicId: signature.publicId,
    version: 1_700_000_000,
    secureUrl: `https://media.test.invalid/${signature.publicId}.jpg`,
    width: 1600,
    height: 900,
    bytes: 245_000,
    format: "JPG",
    resourceType: "image",
    signature: signature.signature,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

runMediaStorageContract("InMemoryMediaStorage", () => {
  const storage = new InMemoryMediaStorage({ now: () => 1_000 });
  return {
    storage,
    arrangeValidUpload(signature: UploadSignature) {
      const result = resultFor(signature);
      storage.registerExpectedUpload(result);
      return {
        completed: {
          publicId: result.publicId,
          version: result.version,
          signature: result.signature,
        },
        expected: {
          publicId: result.publicId,
          url: result.secureUrl,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          format: "jpg",
          resourceType: "image" as const,
          createdAt: result.createdAt as string,
        },
      };
    },
  };
});

describe("InMemoryMediaStorage inspection behavior", () => {
  it("generates deterministic signatures from an injected clock", async () => {
    const storage = new InMemoryMediaStorage({
      now: () => 10_000,
      signatureTtlMs: 2_000,
    });

    const first = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const second = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "two",
    });

    expect(first).toMatchObject({
      publicId: "vehicles/vehicle/one/asset-1",
      timestamp: 10_000,
      expiresAt: 12_000,
      signature: "test-signature-1",
    });
    expect(second.publicId).toBe("vehicles/vehicle/two/asset-2");
  });

  it("rejects unknown and tampered upload results", async () => {
    const storage = new InMemoryMediaStorage({ now: () => 1_000 });
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const valid = resultFor(signature);

    const completed: UploadResult = {
      publicId: valid.publicId,
      version: valid.version,
      signature: valid.signature,
    };
    await expect(storage.verifyUploadResult(completed)).rejects.toThrow(
      "Upload result could not be verified.",
    );
    storage.registerExpectedUpload(valid);
    await expect(
      storage.verifyUploadResult({ ...completed, signature: "tampered" }),
    ).rejects.toThrow("Upload result could not be verified.");
  });

  it.each([
    [{ publicId: " " }, TypeError],
    [{ secureUrl: "http://media.test.invalid/fake.jpg" }, TypeError],
    [{ width: 0 }, RangeError],
    [{ height: 1.5 }, RangeError],
    [{ bytes: Number.MAX_SAFE_INTEGER + 1 }, RangeError],
    [{ format: "../jpg" }, TypeError],
  ] as const)("rejects invalid upload result %#", async (change, errorType) => {
    const storage = new InMemoryMediaStorage({ now: () => 1_000 });
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });

    expect(() =>
      storage.registerExpectedUpload({ ...resultFor(signature), ...change }),
    ).toThrow(errorType);
  });

  it("returns frozen asset snapshots that cannot change internal state", async () => {
    const storage = new InMemoryMediaStorage({ now: () => 1_000 });
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const result = resultFor(signature);
    storage.registerExpectedUpload(result);
    await storage.verifyUploadResult({
      publicId: result.publicId,
      version: result.version,
      signature: result.signature,
    });

    const assets = storage.getAssets();
    expect(Object.isFrozen(assets)).toBe(true);
    expect(Object.isFrozen(assets[0])).toBe(true);
    expect(assets).toHaveLength(1);
    expect(storage.getAssets()).toEqual(assets);
  });

  it("returns ordered, frozen operation snapshots", () => {
    const storage = new InMemoryMediaStorage({ now: () => 1_000 });
    storage.buildDeliveryUrl("vehicles/one", { width: 400 });

    const operations = storage.getOperations();
    expect(Object.isFrozen(operations)).toBe(true);
    expect(Object.isFrozen(operations[0])).toBe(true);
    expect(operations).toEqual([
      {
        type: "deliveryUrlBuilt",
        publicId: "vehicles/one",
        url: "https://media.test.invalid/assets/vehicles/one?width=400",
      },
    ]);
  });

  it("reset clears expectations, assets, history, and ID state", async () => {
    const storage = new InMemoryMediaStorage({ now: () => 1_000 });
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const result = resultFor(signature);
    storage.registerExpectedUpload(result);
    await storage.verifyUploadResult({
      publicId: result.publicId,
      version: result.version,
      signature: result.signature,
    });

    storage.reset();

    expect(storage.getAssets()).toEqual([]);
    expect(storage.getOperations()).toEqual([]);
    await expect(
      storage.verifyUploadResult({
        publicId: result.publicId,
        version: result.version,
        signature: result.signature,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      storage.createUploadSignature({
        folder: "vehicles",
        ownerType: "vehicle",
        ownerId: "one",
      }),
    ).resolves.toMatchObject({ signature: "test-signature-1" });
  });

  it.each([
    [{ width: 0 }, RangeError],
    [{ height: 1.5 }, RangeError],
    [{ quality: 101 }, RangeError],
    [{ format: "../jpg" }, TypeError],
    [{ fit: "provider-specific" }, TypeError],
  ] as const)("rejects unsafe transform %#", (transform, errorType) => {
    const storage = new InMemoryMediaStorage();
    expect(() =>
      Reflect.apply(storage.buildDeliveryUrl, storage, [
        "vehicles/one",
        transform,
      ]),
    ).toThrow(errorType);
  });
});
