import { describe, expect, it } from "vitest";

import {
  altTextSchema,
  attachVehicleImageSchema,
  ALT_TEXT_MAX_LENGTH,
  removeVehicleImageSchema,
  reorderVehicleImagesSchema,
  setVehicleCoverSchema,
  updateVehicleImageAltTextSchema,
} from "@/server/modules/vehicle-images/schemas";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const IMAGE_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const IMAGE_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3312";
const STAMP = "2026-08-14T00:00:00.000Z";

const upload = {
  publicId: `vehicles/vehicle/${VEHICLE_ID}/asset-1`,
  version: 123,
  signature: "test-signature-1",
};

describe("vehicle-image alt text schema", () => {
  it("trims surrounding whitespace", () => {
    const parsed = altTextSchema.parse("  Front three-quarter view  ");
    expect(parsed).toBe("Front three-quarter view");
  });

  it("rejects empty and whitespace-only text", () => {
    expect(altTextSchema.safeParse("").success).toBe(false);
    expect(altTextSchema.safeParse("   ").success).toBe(false);
  });

  it("enforces the maximum length after trimming", () => {
    expect(
      altTextSchema.safeParse("a".repeat(ALT_TEXT_MAX_LENGTH)).success,
    ).toBe(true);
    expect(
      altTextSchema.safeParse("a".repeat(ALT_TEXT_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });
});

describe("attachVehicleImageSchema", () => {
  it("accepts a complete, well-formed attachment", () => {
    const parsed = attachVehicleImageSchema.safeParse({
      vehicleId: VEHICLE_ID,
      upload,
      altText: "  A clean cover photo  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.altText).toBe("A clean cover photo");
  });

  it("requires non-empty alt text on attach", () => {
    expect(
      attachVehicleImageSchema.safeParse({
        vehicleId: VEHICLE_ID,
        upload,
        altText: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-UUID vehicle ID", () => {
    expect(
      attachVehicleImageSchema.safeParse({
        vehicleId: "not-a-uuid",
        upload,
        altText: "ok",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown / server-controlled fields", () => {
    expect(
      attachVehicleImageSchema.safeParse({
        vehicleId: VEHICLE_ID,
        upload,
        altText: "ok",
        sortOrder: 0,
        isCover: true,
      }).success,
    ).toBe(false);
  });
});

describe("reorderVehicleImagesSchema", () => {
  it("accepts a valid unique ordering with a timestamp", () => {
    expect(
      reorderVehicleImagesSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageIds: [IMAGE_A, IMAGE_B],
        expectedUpdatedAt: STAMP,
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate image IDs", () => {
    expect(
      reorderVehicleImagesSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageIds: [IMAGE_A, IMAGE_A],
        expectedUpdatedAt: STAMP,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing or invalid expectedUpdatedAt", () => {
    expect(
      reorderVehicleImagesSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageIds: [IMAGE_A],
      }).success,
    ).toBe(false);
    expect(
      reorderVehicleImagesSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageIds: [IMAGE_A],
        expectedUpdatedAt: "not-a-timestamp",
      }).success,
    ).toBe(false);
  });

  it("rejects foreign non-UUID entries", () => {
    expect(
      reorderVehicleImagesSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageIds: ["nope"],
        expectedUpdatedAt: STAMP,
      }).success,
    ).toBe(false);
  });
});

describe("setVehicleCoverSchema", () => {
  it("requires vehicle, image, and timestamp", () => {
    expect(
      setVehicleCoverSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageId: IMAGE_A,
        expectedUpdatedAt: STAMP,
      }).success,
    ).toBe(true);
    expect(
      setVehicleCoverSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageId: IMAGE_A,
      }).success,
    ).toBe(false);
  });
});

describe("updateVehicleImageAltTextSchema", () => {
  it("identifies both vehicle and image and trims text", () => {
    const parsed = updateVehicleImageAltTextSchema.safeParse({
      vehicleId: VEHICLE_ID,
      imageId: IMAGE_A,
      altText: "  Rear view  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.altText).toBe("Rear view");
  });
});

describe("removeVehicleImageSchema", () => {
  it("identifies both vehicle and image", () => {
    expect(
      removeVehicleImageSchema.safeParse({
        vehicleId: VEHICLE_ID,
        imageId: IMAGE_A,
      }).success,
    ).toBe(true);
    expect(
      removeVehicleImageSchema.safeParse({ vehicleId: VEHICLE_ID }).success,
    ).toBe(false);
  });
});
