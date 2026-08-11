import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type {
  CreateUploadSignatureInput,
  DeleteOutcome,
  MediaTransform,
  SignedUploadParameter,
  UploadResult,
  UploadSignature,
  VerifiedAsset,
} from "@/server/integrations/media-storage/types";

export interface InMemoryMediaStorageOptions {
  readonly now?: () => number;
  readonly signatureTtlMs?: number;
  readonly uploadBaseUrl?: string;
  readonly deliveryBaseUrl?: string;
}

export type MediaStorageOperation =
  | Readonly<{ type: "signatureCreated"; publicId: string }>
  | Readonly<{ type: "uploadVerified"; publicId: string }>
  | Readonly<{
      type: "assetDeleted";
      publicId: string;
      outcome: "deleted" | "alreadyMissing";
    }>
  | Readonly<{ type: "deliveryUrlBuilt"; publicId: string; url: string }>;

const DEFAULT_SIGNATURE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_UPLOAD_BASE_URL = "https://uploads.test.invalid/direct";
const DEFAULT_DELIVERY_BASE_URL = "https://media.test.invalid/assets";
const FORMAT_PATTERN = /^[a-z0-9]+$/;
const FIT_MODES = new Set(["cover", "contain", "fill", "fit", "scale"]);

function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }

  return value;
}

function currentTime(now: () => number): number {
  const value = now();

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "The media-storage clock must return a safe timestamp.",
    );
  }

  return value;
}

function normalizedFormat(value: string): string {
  const format = nonEmpty(value, "format").toLowerCase();

  if (!FORMAT_PATTERN.test(format)) {
    throw new TypeError("format must contain only letters and digits.");
  }

  return format;
}

function secureUrl(value: string): string {
  const normalized = nonEmpty(value, "secureUrl");

  try {
    if (new URL(normalized).protocol !== "https:") {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("secureUrl must be an absolute HTTPS URL.");
  }

  return normalized;
}

function normalizeUploadResult(result: UploadResult): UploadResult {
  if (typeof result !== "object" || result === null) {
    throw new TypeError("Upload result must be an object.");
  }

  const resourceType = nonEmpty(
    result.resourceType,
    "resourceType",
  ).toLowerCase();
  if (resourceType !== "image") {
    throw new TypeError("Only image upload results are supported.");
  }

  return Object.freeze({
    publicId: nonEmpty(result.publicId, "publicId"),
    version: positiveSafeInteger(result.version, "version"),
    secureUrl: secureUrl(result.secureUrl),
    width: positiveSafeInteger(result.width, "width"),
    height: positiveSafeInteger(result.height, "height"),
    bytes: positiveSafeInteger(result.bytes, "bytes"),
    format: normalizedFormat(result.format),
    resourceType,
    signature: nonEmpty(result.signature, "signature"),
  });
}

function toVerifiedAsset(result: UploadResult): VerifiedAsset {
  return Object.freeze({
    publicId: result.publicId,
    url: result.secureUrl,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    format: result.format,
  });
}

function copyAsset(asset: VerifiedAsset): VerifiedAsset {
  return Object.freeze({ ...asset });
}

function sameUploadResult(left: UploadResult, right: UploadResult): boolean {
  return (
    left.publicId === right.publicId &&
    left.version === right.version &&
    left.secureUrl === right.secureUrl &&
    left.width === right.width &&
    left.height === right.height &&
    left.bytes === right.bytes &&
    left.format === right.format &&
    left.resourceType === right.resourceType &&
    left.signature === right.signature
  );
}

function normalizeTransform(
  transform: MediaTransform | undefined,
): Readonly<Record<string, string>> {
  if (transform === undefined) return Object.freeze({});
  if (typeof transform !== "object" || transform === null) {
    throw new TypeError("Media transform must be an object.");
  }

  const values: Record<string, string> = {};
  if (transform.width !== undefined) {
    values.width = String(positiveSafeInteger(transform.width, "width"));
  }
  if (transform.height !== undefined) {
    values.height = String(positiveSafeInteger(transform.height, "height"));
  }
  if (transform.fit !== undefined) {
    if (!FIT_MODES.has(transform.fit)) {
      throw new TypeError("fit must be a supported media fit mode.");
    }
    values.fit = transform.fit;
  }
  if (transform.quality !== undefined) {
    const quality = positiveSafeInteger(transform.quality, "quality");
    if (quality > 100) throw new RangeError("quality must not exceed 100.");
    values.quality = String(quality);
  }
  if (transform.format !== undefined) {
    values.format = normalizedFormat(transform.format);
  }
  if (transform.devicePixelRatio !== undefined) {
    values.dpr = String(
      positiveSafeInteger(transform.devicePixelRatio, "devicePixelRatio"),
    );
  }

  return Object.freeze(values);
}

function copyOperation(
  operation: MediaStorageOperation,
): MediaStorageOperation {
  return Object.freeze({ ...operation });
}

export class InMemoryMediaStorage implements MediaStorage {
  readonly #now: () => number;
  readonly #signatureTtlMs: number;
  readonly #uploadBaseUrl: string;
  readonly #deliveryBaseUrl: string;
  readonly #expectedUploads = new Map<string, UploadResult>();
  readonly #assets = new Map<string, VerifiedAsset>();
  readonly #operations: MediaStorageOperation[] = [];
  #nextSignatureId = 1;

  constructor(options: InMemoryMediaStorageOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#signatureTtlMs = positiveSafeInteger(
      options.signatureTtlMs ?? DEFAULT_SIGNATURE_TTL_MS,
      "signatureTtlMs",
    );
    this.#uploadBaseUrl = nonEmpty(
      options.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL,
      "uploadBaseUrl",
    ).replace(/\/$/, "");
    this.#deliveryBaseUrl = nonEmpty(
      options.deliveryBaseUrl ?? DEFAULT_DELIVERY_BASE_URL,
      "deliveryBaseUrl",
    ).replace(/\/$/, "");
  }

  async createUploadSignature(
    input: CreateUploadSignatureInput,
  ): Promise<UploadSignature> {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Upload signature input must be an object.");
    }

    const folder = nonEmpty(input.folder, "folder");
    const ownerType = nonEmpty(input.ownerType, "ownerType");
    const ownerId = nonEmpty(input.ownerId, "ownerId");
    const timestamp = currentTime(this.#now);
    const expiresAt = timestamp + this.#signatureTtlMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError("Upload signature expiry must be a safe timestamp.");
    }
    const sequence = this.#nextSignatureId++;
    const publicId = `${folder}/${ownerType}/${ownerId}/asset-${sequence}`;
    const signature = `test-signature-${sequence}`;
    const signedParameters: Readonly<Record<string, SignedUploadParameter>> =
      Object.freeze({ publicId, timestamp });
    const result = Object.freeze({
      uploadUrl: this.#uploadBaseUrl,
      publicId,
      timestamp,
      expiresAt,
      signature,
      signedParameters,
    });

    this.#operations.push(
      Object.freeze({ type: "signatureCreated", publicId }),
    );
    return result;
  }

  registerExpectedUpload(result: UploadResult): void {
    const normalized = normalizeUploadResult(result);
    this.#expectedUploads.set(normalized.publicId, normalized);
  }

  async verifyUploadResult(result: UploadResult): Promise<VerifiedAsset> {
    const normalized = normalizeUploadResult(result);
    const expected = this.#expectedUploads.get(normalized.publicId);

    if (expected === undefined || !sameUploadResult(expected, normalized)) {
      throw new TypeError("Upload result could not be verified.");
    }

    const asset = toVerifiedAsset(normalized);
    this.#assets.set(asset.publicId, asset);
    this.#operations.push(
      Object.freeze({ type: "uploadVerified", publicId: asset.publicId }),
    );
    return copyAsset(asset);
  }

  async deleteAsset(publicId: string): Promise<DeleteOutcome> {
    const normalized = nonEmpty(publicId, "publicId");
    const deleted = this.#assets.delete(normalized);
    const status = deleted ? "deleted" : "alreadyMissing";
    const outcome = Object.freeze({ status });

    this.#operations.push(
      Object.freeze({
        type: "assetDeleted",
        publicId: normalized,
        outcome: status,
      }),
    );
    return outcome;
  }

  buildDeliveryUrl(publicId: string, transform?: MediaTransform): string {
    const normalized = nonEmpty(publicId, "publicId");
    const parameters = new URLSearchParams(normalizeTransform(transform));
    parameters.sort();
    const query = parameters.size === 0 ? "" : `?${parameters.toString()}`;
    const path = normalized.split("/").map(encodeURIComponent).join("/");
    const url = `${this.#deliveryBaseUrl}/${path}${query}`;

    this.#operations.push(
      Object.freeze({ type: "deliveryUrlBuilt", publicId: normalized, url }),
    );
    return url;
  }

  getAssets(): ReadonlyArray<VerifiedAsset> {
    return Object.freeze([...this.#assets.values()].map(copyAsset));
  }

  getOperations(): ReadonlyArray<MediaStorageOperation> {
    return Object.freeze(this.#operations.map(copyOperation));
  }

  reset(): void {
    this.#expectedUploads.clear();
    this.#assets.clear();
    this.#operations.length = 0;
    this.#nextSignatureId = 1;
  }
}
