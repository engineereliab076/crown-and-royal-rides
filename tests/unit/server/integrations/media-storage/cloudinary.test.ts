import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CloudinaryMediaStorage,
  type CloudinaryDestroyOptions,
  type CloudinaryFacade,
  type CloudinaryUrlOptions,
} from "@/server/integrations/media-storage/cloudinary";
import type {
  UploadResult,
  UploadSignature,
} from "@/server/integrations/media-storage/types";
import { runMediaStorageContract } from "./contract";

const API_SECRET = "fake-cloudinary-secret";

function fakeSign(
  parameters: Readonly<Record<string, string | number>>,
  secret: string,
): string {
  const source = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${source}${secret}`).digest("hex");
}

interface FakeCloudinary extends CloudinaryFacade {
  readonly sign: ReturnType<typeof vi.fn<CloudinaryFacade["sign"]>>;
  readonly destroy: ReturnType<typeof vi.fn<CloudinaryFacade["destroy"]>>;
  readonly url: ReturnType<typeof vi.fn<CloudinaryFacade["url"]>>;
}

function createFacade(): FakeCloudinary {
  return {
    sign: vi.fn(fakeSign),
    destroy: vi.fn(async () => ({ result: "ok" })),
    url: vi.fn((publicId, options) => {
      const transformation =
        options.format ?? options.fetch_format ?? "original";
      return `https://res.cloudinary.com/demo-cloud/image/upload/f_${transformation}/${publicId}`;
    }),
  };
}

function createStorage(client: CloudinaryFacade = createFacade()) {
  return new CloudinaryMediaStorage(
    {
      cloudName: "demo-cloud",
      apiKey: "fake-api-key",
      apiSecret: API_SECRET,
      folderPrefix: "dev",
    },
    {
      client,
      now: () => 1_700_000_000_000,
      createId: () => "00000000-0000-4000-8000-000000000001",
    },
  );
}

function resultFor(signature: UploadSignature): UploadResult {
  const version = 1_700_000_001;
  return {
    publicId: signature.publicId,
    version,
    secureUrl: `https://res.cloudinary.com/demo-cloud/image/upload/v${version}/${signature.publicId}.jpg`,
    width: 1600,
    height: 900,
    bytes: 245_000,
    format: "JPG",
    resourceType: "image",
    signature: fakeSign({ public_id: signature.publicId, version }, API_SECRET),
  };
}

runMediaStorageContract("CloudinaryMediaStorage", () => {
  const client = createFacade();
  client.destroy
    .mockResolvedValueOnce({ result: "ok" })
    .mockResolvedValueOnce({ result: "not found" });
  return {
    storage: createStorage(client),
    deliveryPublicId: "dev/vehicles/example",
    arrangeValidUpload: resultFor,
  };
});

describe("CloudinaryMediaStorage provider mapping", () => {
  it("signs constrained image upload parameters in the configured namespace", async () => {
    const client = createFacade();
    const storage = createStorage(client);
    const signature = await storage.createUploadSignature({
      folder: "vehicle-images",
      ownerType: "Vehicle",
      ownerId: "VEHICLE-123",
    });

    expect(signature).toMatchObject({
      uploadUrl: "https://api.cloudinary.com/v1_1/demo-cloud/image/upload",
      timestamp: 1_700_000_000,
      expiresAt: 1_700_000_300,
    });
    expect(signature.publicId).toMatch(
      /^dev\/vehicle-images\/vehicle\/vehicle-123\/asset-/,
    );
    expect(client.sign).toHaveBeenCalledWith(
      {
        allowed_formats: "jpg,jpeg,png,webp,avif",
        overwrite: "false",
        public_id: signature.publicId,
        timestamp: 1_700_000_000,
        type: "upload",
      },
      API_SECRET,
    );
    expect(JSON.stringify(signature)).not.toContain(API_SECRET);
  });

  it.each(["..", "folder/escape", "folder\\escape", "/escape", "two//parts"])(
    "rejects unsafe namespace input %s",
    async (folder) => {
      await expect(
        createStorage().createUploadSignature({
          folder,
          ownerType: "vehicle",
          ownerId: "one",
        }),
      ).rejects.toThrow(TypeError);
    },
  );

  it("verifies public_id and version rather than the upload-request signature", async () => {
    const client = createFacade();
    const storage = createStorage(client);
    const uploadSignature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    client.sign.mockClear();

    await storage.verifyUploadResult(resultFor(uploadSignature));

    expect(client.sign).toHaveBeenCalledWith(
      { public_id: uploadSignature.publicId, version: 1_700_000_001 },
      API_SECRET,
    );
  });

  it.each([
    [{ signature: "" }, TypeError],
    [{ signature: "0".repeat(40) }, TypeError],
    [{ publicId: "prod/vehicles/vehicle/one/asset-id" }, TypeError],
    [{ width: 0 }, RangeError],
    [{ bytes: -1 }, RangeError],
    [{ format: "svg" }, TypeError],
    [{ secureUrl: "https://attacker.example/fake.jpg" }, TypeError],
  ] as const)(
    "rejects unsafe upload response %#",
    async (change, errorType) => {
      const storage = createStorage();
      const signature = await storage.createUploadSignature({
        folder: "vehicles",
        ownerType: "vehicle",
        ownerId: "one",
      });
      await expect(
        storage.verifyUploadResult({ ...resultFor(signature), ...change }),
      ).rejects.toThrow(errorType);
    },
  );

  it("ignores unknown upload fields and leaves caller data unchanged", async () => {
    const storage = createStorage();
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const result = { ...resultFor(signature), futureProviderField: "ignored" };
    const snapshot = structuredClone(result);

    await expect(storage.verifyUploadResult(result)).resolves.toMatchObject({
      publicId: signature.publicId,
    });
    expect(result).toEqual(snapshot);
  });

  it("requests image deletion with CDN invalidation and maps safe outcomes", async () => {
    const client = createFacade();
    client.destroy.mockRejectedValueOnce(new Error("provider payload marker"));
    const storage = createStorage(client);
    const outcome = await storage.deleteAsset(
      "dev/vehicles/vehicle/one/asset-id",
    );

    expect(outcome).toEqual({
      status: "failed",
      reason: "Media provider could not delete the asset.",
    });
    const options = client.destroy.mock.calls[0]?.[1] as
      CloudinaryDestroyOptions | undefined;
    expect(options).toMatchObject({
      resource_type: "image",
      type: "upload",
      invalidate: true,
    });
    expect(JSON.stringify(outcome)).not.toContain("provider payload marker");
  });

  it("maps neutral transforms through the HTTPS Cloudinary URL builder", () => {
    const client = createFacade();
    const storage = createStorage(client);
    storage.buildDeliveryUrl("dev/vehicles/vehicle/one/asset-id", {
      width: 800,
      height: 600,
      fit: "cover",
      quality: 80,
      format: "webp",
      devicePixelRatio: 2,
    });

    const options = client.url.mock.calls[0]?.[1] as
      CloudinaryUrlOptions | undefined;
    expect(options).toEqual({
      cloud_name: "demo-cloud",
      secure: true,
      resource_type: "image",
      type: "upload",
      quality: 80,
      format: "webp",
      width: 800,
      height: 600,
      crop: "fill",
      dpr: 2,
    });
  });
});
