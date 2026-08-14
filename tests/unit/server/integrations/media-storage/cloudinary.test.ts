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
  readonly resource: ReturnType<typeof vi.fn<CloudinaryFacade["resource"]>>;
  readonly url: ReturnType<typeof vi.fn<CloudinaryFacade["url"]>>;
}

function createFacade(): FakeCloudinary {
  return {
    sign: vi.fn(fakeSign),
    destroy: vi.fn(async () => ({ result: "ok" })),
    resource: vi.fn(),
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
    signature: fakeSign({ public_id: signature.publicId, version }, API_SECRET),
  };
}

function resourceFor(
  signature: UploadSignature,
  overrides: Record<string, unknown> = {},
) {
  const version = 1_700_000_001;
  return {
    public_id: signature.publicId,
    version,
    secure_url: `https://res.cloudinary.com/demo-cloud/image/upload/v${version}/${signature.publicId}.jpg`,
    width: 1600,
    height: 900,
    bytes: 245_000,
    format: "JPG",
    resource_type: "image",
    type: "upload",
    created_at: "2023-11-14T22:13:21.000Z",
    ...overrides,
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
    arrangeValidUpload(signature) {
      client.resource.mockResolvedValue(resourceFor(signature));
      return {
        completed: resultFor(signature),
        expected: {
          publicId: signature.publicId,
          url: resourceFor(signature).secure_url,
          width: 1600,
          height: 900,
          bytes: 245_000,
          format: "jpg",
          resourceType: "image" as const,
          createdAt: "2023-11-14T22:13:21.000Z",
        },
      };
    },
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
        allowed_formats: "jpg,jpeg,png,webp",
        folder: expect.stringMatching(
          /^dev\/vehicle-images\/vehicle\/vehicle-123$/,
        ),
        overwrite: "false",
        public_id: expect.stringMatching(/^asset-/),
        timestamp: 1_700_000_000,
        transformation: "c_limit,w_6000,h_6000",
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
    client.resource.mockResolvedValue(resourceFor(uploadSignature));

    await storage.verifyUploadResult(resultFor(uploadSignature));

    expect(client.sign).toHaveBeenCalledWith(
      { public_id: uploadSignature.publicId, version: 1_700_000_001 },
      API_SECRET,
    );
    expect(client.resource).toHaveBeenCalledWith(
      uploadSignature.publicId,
      expect.objectContaining({ resource_type: "image", type: "upload" }),
    );
  });

  it.each([
    [{ width: 0 }, RangeError],
    [{ height: 6001 }, RangeError],
    [{ bytes: 10 * 1024 * 1024 + 1 }, RangeError],
    [{ format: "svg" }, TypeError],
    [{ resource_type: "video" }, TypeError],
    [{ created_at: "2023-11-14T21:00:00.000Z" }, TypeError],
    [{ created_at: "2023-11-14T23:00:00.000Z" }, TypeError],
    [{ secure_url: "https://attacker.example/fake.jpg" }, TypeError],
  ] as const)(
    "rejects unsafe inspected resource %#",
    async (change, errorType) => {
      const client = createFacade();
      const storage = createStorage(client);
      const signature = await storage.createUploadSignature({
        folder: "vehicles",
        ownerType: "vehicle",
        ownerId: "one",
      });
      client.resource.mockResolvedValue(resourceFor(signature, change));
      await expect(
        storage.verifyUploadResult(resultFor(signature)),
      ).rejects.toThrow(errorType);
    },
  );

  it.each([
    { signature: "" },
    { signature: "0".repeat(40) },
    { publicId: "prod/vehicles/vehicle/one/asset-id" },
  ])("rejects tampered completion metadata %#", async (change) => {
    const storage = createStorage();
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    await expect(
      storage.verifyUploadResult({ ...resultFor(signature), ...change }),
    ).rejects.toThrow(TypeError);
  });

  it("ignores unknown upload fields and leaves caller data unchanged", async () => {
    const client = createFacade();
    const storage = createStorage(client);
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    const result = { ...resultFor(signature), futureProviderField: "ignored" };
    const snapshot = structuredClone(result);
    client.resource.mockResolvedValue(resourceFor(signature));

    await expect(storage.verifyUploadResult(result)).resolves.toMatchObject({
      publicId: signature.publicId,
    });
    expect(result).toEqual(snapshot);
  });

  it("translates provider inspection failures without leaking provider details", async () => {
    const client = createFacade();
    const storage = createStorage(client);
    const signature = await storage.createUploadSignature({
      folder: "vehicles",
      ownerType: "vehicle",
      ownerId: "one",
    });
    client.resource.mockRejectedValue(new Error("provider response marker"));
    try {
      await storage.verifyUploadResult(resultFor(signature));
      throw new Error("Expected verification to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "INTEGRATION_UNAVAILABLE",
        message: "An external integration is temporarily unavailable.",
      });
      expect(
        error instanceof Error ? error.message : String(error),
      ).not.toContain("provider response marker");
    }
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
