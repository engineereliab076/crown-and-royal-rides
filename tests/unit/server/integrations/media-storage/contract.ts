import { describe, expect, it } from "vitest";

import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type {
  UploadResult,
  UploadSignature,
  VerifiedAsset,
} from "@/server/integrations/media-storage/types";

export interface MediaStorageContractHarness {
  readonly storage: MediaStorage;
  readonly deliveryPublicId?: string;
  arrangeValidUpload(signature: UploadSignature): {
    readonly completed: UploadResult;
    readonly expected: VerifiedAsset;
  };
}

export function runMediaStorageContract(
  name: string,
  createHarness: () => MediaStorageContractHarness,
): void {
  describe(`${name} MediaStorage contract`, () => {
    it("creates a neutral direct-upload signature", async () => {
      const { storage } = createHarness();
      const signature = await storage.createUploadSignature({
        folder: "vehicle-images",
        ownerType: "vehicle",
        ownerId: "vehicle-123",
      });

      expect(signature.uploadUrl).toMatch(/^https:\/\//);
      expect(signature.publicId).toContain("vehicle-123");
      expect(signature.expiresAt).toBeGreaterThan(signature.timestamp);
      expect(signature.signature).not.toHaveLength(0);
      expect(signature.uploadPublicId).toBeTruthy();
      expect(signature.transformation).toBe("c_limit,w_6000,h_6000");
    });

    it.each(["folder", "ownerType", "ownerId"] as const)(
      "rejects a blank %s",
      async (field) => {
        const { storage } = createHarness();
        const input = {
          folder: "vehicle-images",
          ownerType: "vehicle",
          ownerId: "vehicle-123",
          [field]: "   ",
        };

        await expect(storage.createUploadSignature(input)).rejects.toThrow(
          TypeError,
        );
      },
    );

    it("verifies and normalizes an arranged image result", async () => {
      const harness = createHarness();
      const signature = await harness.storage.createUploadSignature({
        folder: "vehicle-images",
        ownerType: "vehicle",
        ownerId: "vehicle-123",
      });
      const result = harness.arrangeValidUpload(signature);

      await expect(
        harness.storage.verifyUploadResult(result.completed),
      ).resolves.toEqual(result.expected);
    });

    it("rejects non-image upload results", async () => {
      const harness = createHarness();
      const signature = await harness.storage.createUploadSignature({
        folder: "vehicle-images",
        ownerType: "vehicle",
        ownerId: "vehicle-123",
      });
      const result = harness.arrangeValidUpload(signature);
      await expect(
        harness.storage.verifyUploadResult({
          ...result.completed,
          signature: "tampered-signature",
        }),
      ).rejects.toThrow(TypeError);
    });

    it("deletes a verified asset idempotently", async () => {
      const harness = createHarness();
      const signature = await harness.storage.createUploadSignature({
        folder: "vehicle-images",
        ownerType: "vehicle",
        ownerId: "vehicle-123",
      });
      await harness.storage.verifyUploadResult(
        harness.arrangeValidUpload(signature).completed,
      );

      await expect(
        harness.storage.deleteAsset(signature.publicId),
      ).resolves.toEqual({ status: "deleted" });
      await expect(
        harness.storage.deleteAsset(signature.publicId),
      ).resolves.toEqual({ status: "alreadyMissing" });
    });

    it("builds a deterministic delivery URL from application transforms", () => {
      const { storage, deliveryPublicId = "vehicles/example" } =
        createHarness();
      const transform = {
        width: 800,
        height: 600,
        fit: "cover" as const,
        quality: 80,
        format: "WEBP",
        devicePixelRatio: 2,
      };

      expect(storage.buildDeliveryUrl(deliveryPublicId, transform)).toBe(
        storage.buildDeliveryUrl(deliveryPublicId, transform),
      );
      expect(storage.buildDeliveryUrl(deliveryPublicId, transform)).toMatch(
        /^https:\/\//,
      );
    });
  });
}
