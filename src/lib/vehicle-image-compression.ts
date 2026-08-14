/**
 * Client-side vehicle-image compression (Phase 4, Group 3).
 *
 * Runs in the browser before any upload authorization is requested. It accepts
 * only JPEG/PNG/WebP, rejects inputs over a generous pre-compression safety
 * limit, downscales the longest edge to at most 2400 px, strips EXIF metadata by
 * default, keeps the output an allowed format, and guarantees the result stays
 * below the server's verified 10 MB limit. A compression failure is surfaced as a
 * typed error for a single file — the caller must never silently upload an
 * uncompressed fallback.
 *
 * The underlying compressor is injectable so this module is unit-testable in Node
 * without importing the browser-only `browser-image-compression` package.
 */

export const VEHICLE_IMAGE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type VehicleImageMimeType = (typeof VEHICLE_IMAGE_ALLOWED_TYPES)[number];

/** Longest-edge target after downscaling. */
export const VEHICLE_IMAGE_MAX_EDGE = 2400;
/** Hard ceiling for the compressed output; matches the server verified limit. */
export const VEHICLE_IMAGE_OUTPUT_MAX_BYTES = 10 * 1024 * 1024;
/** Target output size handed to the compressor (kept well under the ceiling). */
export const VEHICLE_IMAGE_TARGET_MB = 8;
/** Pre-compression input safety limit; larger raw files are rejected outright. */
export const VEHICLE_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;

export type CompressionErrorCode =
  | "INVALID_TYPE"
  | "INPUT_TOO_LARGE"
  | "COMPRESSION_FAILED"
  | "OUTPUT_TOO_LARGE";

export class VehicleImageCompressionError extends Error {
  readonly code: CompressionErrorCode;
  constructor(code: CompressionErrorCode, message: string) {
    super(message);
    this.name = "VehicleImageCompressionError";
    this.code = code;
  }
}

/** Options passed to the underlying compressor (a subset of the library's). */
export interface CompressorOptions {
  readonly maxWidthOrHeight: number;
  readonly maxSizeMB: number;
  readonly useWebWorker: boolean;
  /** Never preserve EXIF: strip orientation/geolocation metadata by default. */
  readonly preserveExif: boolean;
  readonly fileType: string;
}

export type Compressor = (
  file: File,
  options: CompressorOptions,
) => Promise<Blob>;

export interface CompressedImage {
  readonly blob: Blob;
  readonly fileName: string;
  readonly type: string;
}

function isAllowedType(type: string): type is VehicleImageMimeType {
  return (VEHICLE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(type);
}

/** Build the exact, safe compressor options for a given input MIME type. */
export function buildCompressorOptions(type: string): CompressorOptions {
  return {
    maxWidthOrHeight: VEHICLE_IMAGE_MAX_EDGE,
    maxSizeMB: VEHICLE_IMAGE_TARGET_MB,
    useWebWorker: true,
    preserveExif: false,
    // Keep the output in the same (already-allowed) format.
    fileType: type,
  };
}

let defaultCompressor: Compressor | undefined;

async function resolveDefaultCompressor(): Promise<Compressor> {
  if (defaultCompressor !== undefined) return defaultCompressor;
  const mod = await import("browser-image-compression");
  const compress = mod.default;
  defaultCompressor = (file, options) => compress(file, options);
  return defaultCompressor;
}

export interface CompressVehicleImageOptions {
  /** Injectable underlying compressor; defaults to browser-image-compression. */
  readonly compressor?: Compressor;
}

export async function compressVehicleImage(
  file: File,
  options: CompressVehicleImageOptions = {},
): Promise<CompressedImage> {
  if (!isAllowedType(file.type)) {
    throw new VehicleImageCompressionError(
      "INVALID_TYPE",
      "Choose a JPEG, PNG, or WebP image.",
    );
  }
  if (file.size <= 0 || file.size > VEHICLE_IMAGE_INPUT_MAX_BYTES) {
    throw new VehicleImageCompressionError(
      "INPUT_TOO_LARGE",
      "The image is too large to process. Choose a smaller file.",
    );
  }

  const compressor = options.compressor ?? (await resolveDefaultCompressor());
  let blob: Blob;
  try {
    blob = await compressor(file, buildCompressorOptions(file.type));
  } catch {
    // Never fall back to an uncompressed upload; the failure is per-file.
    throw new VehicleImageCompressionError(
      "COMPRESSION_FAILED",
      "The image could not be processed. Try a different file.",
    );
  }

  if (!isAllowedType(blob.type) && blob.type !== "") {
    throw new VehicleImageCompressionError(
      "COMPRESSION_FAILED",
      "The processed image was not a supported format.",
    );
  }
  if (blob.size <= 0 || blob.size > VEHICLE_IMAGE_OUTPUT_MAX_BYTES) {
    throw new VehicleImageCompressionError(
      "OUTPUT_TOO_LARGE",
      "The image is still too large after processing.",
    );
  }

  return {
    blob,
    fileName: file.name,
    type: isAllowedType(blob.type) ? blob.type : file.type,
  };
}
