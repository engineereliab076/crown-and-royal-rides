import { describe, expect, it, vi } from "vitest";

import {
  buildCompressorOptions,
  compressVehicleImage,
  VehicleImageCompressionError,
  VEHICLE_IMAGE_INPUT_MAX_BYTES,
  VEHICLE_IMAGE_MAX_EDGE,
  VEHICLE_IMAGE_OUTPUT_MAX_BYTES,
  type Compressor,
} from "@/lib/vehicle-image-compression";

function fakeFile(type: string, size: number, name = "photo.jpg"): File {
  const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  // Report the intended size without allocating a huge buffer.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function blob(type: string, size: number): Blob {
  const payload = new Uint8Array(Math.min(size, 1024));
  const b = new Blob([payload], { type });
  // Force the reported size without allocating huge buffers.
  Object.defineProperty(b, "size", { value: size });
  return b;
}

describe("vehicle image compression options", () => {
  it("uses a 2400px longest edge and never preserves EXIF", () => {
    const options = buildCompressorOptions("image/jpeg");
    expect(options.maxWidthOrHeight).toBe(VEHICLE_IMAGE_MAX_EDGE);
    expect(VEHICLE_IMAGE_MAX_EDGE).toBe(2400);
    expect(options.preserveExif).toBe(false);
    expect(options.fileType).toBe("image/jpeg");
    expect(options.maxSizeMB * 1024 * 1024).toBeLessThan(
      VEHICLE_IMAGE_OUTPUT_MAX_BYTES,
    );
  });
});

describe("compressVehicleImage", () => {
  it("compresses an allowed file and returns a safe blob", async () => {
    const compressor = vi.fn<Compressor>(async () =>
      blob("image/jpeg", 300_000),
    );
    const result = await compressVehicleImage(
      fakeFile("image/jpeg", 4_000_000),
      {
        compressor,
      },
    );
    expect(compressor).toHaveBeenCalledTimes(1);
    expect(compressor.mock.calls[0]?.[1]).toMatchObject({
      maxWidthOrHeight: 2400,
      preserveExif: false,
    });
    expect(result.blob.size).toBe(300_000);
    expect(result.type).toBe("image/jpeg");
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain"])(
    "rejects the disallowed type %s",
    async (type) => {
      await expect(
        compressVehicleImage(fakeFile(type, 1000), {
          compressor: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: "INVALID_TYPE" });
    },
  );

  it("rejects an input over the pre-compression safety limit", async () => {
    const compressor = vi.fn();
    await expect(
      compressVehicleImage(
        fakeFile("image/png", VEHICLE_IMAGE_INPUT_MAX_BYTES + 1),
        {
          compressor,
        },
      ),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(compressor).not.toHaveBeenCalled();
  });

  it("surfaces a per-file failure and never falls back to uncompressed", async () => {
    const compressor = vi.fn(async () => {
      throw new Error("canvas failure");
    });
    await expect(
      compressVehicleImage(fakeFile("image/webp", 2_000_000), { compressor }),
    ).rejects.toBeInstanceOf(VehicleImageCompressionError);
  });

  it("rejects an output that is still above the server limit", async () => {
    const compressor = vi.fn(async () =>
      blob("image/jpeg", VEHICLE_IMAGE_OUTPUT_MAX_BYTES + 1),
    );
    await expect(
      compressVehicleImage(fakeFile("image/jpeg", 5_000_000), { compressor }),
    ).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  });

  it("does not log file metadata (no console usage in the module)", async () => {
    const spy = vi.spyOn(console, "log");
    const compressor = vi.fn(async () => blob("image/jpeg", 100_000));
    await compressVehicleImage(
      fakeFile("image/jpeg", 1_000_000, "secret.jpg"),
      {
        compressor,
      },
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
