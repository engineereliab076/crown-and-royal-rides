import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";

import { IntegrationUnavailableError } from "@/server/integrations/errors";
import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type {
  CreateUploadSignatureInput,
  DeleteOutcome,
  MediaFitMode,
  MediaTransform,
  UploadResult,
  UploadSignature,
  VerifiedAsset,
} from "@/server/integrations/media-storage/types";

export interface CloudinaryMediaStorageConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly folderPrefix: string;
  readonly signatureTtlSeconds?: number;
}

export interface CloudinaryDestroyOptions {
  readonly cloud_name: string;
  readonly api_key: string;
  readonly api_secret: string;
  readonly resource_type: "image";
  readonly type: "upload";
  readonly invalidate: true;
}

export interface CloudinaryUrlOptions {
  readonly cloud_name: string;
  readonly secure: true;
  readonly resource_type: "image";
  readonly type: "upload";
  readonly fetch_format?: string;
  readonly format?: string;
  readonly quality: string | number;
  readonly width?: number;
  readonly height?: number;
  readonly crop?: string;
  readonly dpr?: number;
}

export interface CloudinaryFacade {
  sign(
    parameters: Readonly<Record<string, string | number>>,
    apiSecret: string,
  ): string;
  destroy(
    publicId: string,
    options: CloudinaryDestroyOptions,
  ): Promise<Readonly<{ result?: unknown }>>;
  resource(
    publicId: string,
    options: Readonly<{
      cloud_name: string;
      api_key: string;
      api_secret: string;
      resource_type: "image";
      type: "upload";
    }>,
  ): Promise<unknown>;
  url(publicId: string, options: CloudinaryUrlOptions): string;
}

export interface CloudinaryMediaStorageDependencies {
  readonly client?: CloudinaryFacade;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const DEFAULT_SIGNATURE_TTL_SECONDS = 5 * 60;
const COMPLETED_UPLOAD_MAX_AGE_SECONDS = 15 * 60;
export const VEHICLE_IMAGE_ALLOWED_FORMATS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
] as const;
export const VEHICLE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VEHICLE_IMAGE_MAX_WIDTH = 6000;
export const VEHICLE_IMAGE_MAX_HEIGHT = 6000;
const ALLOWED_FORMATS = new Set<string>(VEHICLE_IMAGE_ALLOWED_FORMATS);
const SIGNATURE_PATTERN = /^[a-f0-9]{40}$/i;
const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const FIT_MAP: Readonly<Record<MediaFitMode, string>> = Object.freeze({
  cover: "fill",
  contain: "fit",
  fill: "fill",
  fit: "fit",
  scale: "scale",
});

function required(value: string, field: string): string {
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

function safeSegment(value: string, field: string): string {
  const segment = required(value, field).normalize("NFKC").toLowerCase();
  if (
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    !SAFE_SEGMENT_PATTERN.test(segment)
  ) {
    throw new TypeError(
      `${field} must contain only letters, digits, underscores, and hyphens.`,
    );
  }
  return segment;
}

function safePublicId(value: string, folderPrefix: string): string {
  const publicId = required(value, "publicId");
  if (
    publicId.startsWith("/") ||
    publicId.includes("\\") ||
    publicId.includes("//")
  ) {
    throw new TypeError("publicId must be a safe media namespace path.");
  }
  const segments = publicId.split("/");
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SAFE_SEGMENT_PATTERN.test(segment),
    ) ||
    segments[0] !== folderPrefix
  ) {
    throw new TypeError(
      "publicId must belong to the configured media namespace.",
    );
  }
  return publicId;
}

function safeHttpsUrl(value: string, cloudName: string): string {
  const urlValue = required(value, "secureUrl");
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new TypeError("secureUrl must be an absolute HTTPS Cloudinary URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.hostname !== "res.cloudinary.com" ||
    !url.pathname.startsWith(`/${cloudName}/image/upload/`)
  ) {
    throw new TypeError("secureUrl must be an absolute HTTPS Cloudinary URL.");
  }
  return urlValue;
}

function safeFormat(value: string): string {
  const format = required(value, "format").toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw new TypeError("format must be an approved image format.");
  }
  return format;
}

function equalSignature(expected: string, supplied: string): boolean {
  if (!SIGNATURE_PATTERN.test(expected) || !SIGNATURE_PATTERN.test(supplied)) {
    return false;
  }
  const expectedBytes = Buffer.from(expected.toLowerCase(), "hex");
  const suppliedBytes = Buffer.from(supplied.toLowerCase(), "hex");
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function normalizeTransform(transform: MediaTransform | undefined): {
  readonly width?: number;
  readonly height?: number;
  readonly crop?: string;
  readonly quality: string | number;
  readonly fetch_format?: string;
  readonly format?: string;
  readonly dpr?: number;
} {
  if (transform === undefined) {
    return Object.freeze({ quality: "auto", fetch_format: "auto" });
  }
  if (typeof transform !== "object" || transform === null) {
    throw new TypeError("Media transform must be an object.");
  }

  const width =
    transform.width === undefined
      ? undefined
      : positiveSafeInteger(transform.width, "width");
  const height =
    transform.height === undefined
      ? undefined
      : positiveSafeInteger(transform.height, "height");
  const quality =
    transform.quality === undefined
      ? "auto"
      : positiveSafeInteger(transform.quality, "quality");
  if (typeof quality === "number" && quality > 100) {
    throw new RangeError("quality must not exceed 100.");
  }
  const format =
    transform.format === undefined ? undefined : safeFormat(transform.format);
  const dpr =
    transform.devicePixelRatio === undefined
      ? undefined
      : positiveSafeInteger(transform.devicePixelRatio, "devicePixelRatio");
  if (dpr !== undefined && width === undefined && height === undefined) {
    throw new TypeError("devicePixelRatio requires a width or height.");
  }
  const crop = transform.fit === undefined ? undefined : FIT_MAP[transform.fit];
  if (transform.fit !== undefined && crop === undefined) {
    throw new TypeError("fit must be a supported media fit mode.");
  }

  return Object.freeze({
    quality,
    ...(format === undefined ? { fetch_format: "auto" } : { format }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(crop === undefined ? {} : { crop }),
    ...(dpr === undefined ? {} : { dpr }),
  });
}

function defaultFacade(): CloudinaryFacade {
  return {
    sign: (parameters, apiSecret) =>
      cloudinary.utils.api_sign_request(parameters, apiSecret),
    destroy: (publicId, options) =>
      Reflect.apply(cloudinary.uploader.destroy, cloudinary.uploader, [
        publicId,
        options,
      ]) as Promise<Readonly<{ result?: unknown }>>,
    resource: (publicId, options) =>
      Reflect.apply(cloudinary.api.resource, cloudinary.api, [
        publicId,
        options,
      ]) as Promise<unknown>,
    url: (publicId, options) => cloudinary.url(publicId, options),
  };
}

export class CloudinaryMediaStorage implements MediaStorage {
  readonly #cloudName: string;
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #folderPrefix: string;
  readonly #signatureTtlSeconds: number;
  readonly #client: CloudinaryFacade;
  readonly #now: () => number;
  readonly #createId: () => string;

  constructor(
    config: CloudinaryMediaStorageConfig,
    dependencies: CloudinaryMediaStorageDependencies = {},
  ) {
    if (typeof config !== "object" || config === null) {
      throw new TypeError("Cloudinary configuration must be an object.");
    }
    this.#cloudName = safeSegment(config.cloudName, "Cloudinary cloudName");
    this.#apiKey = required(config.apiKey, "Cloudinary apiKey");
    this.#apiSecret = required(config.apiSecret, "Cloudinary apiSecret");
    this.#folderPrefix = safeSegment(
      config.folderPrefix,
      "Cloudinary folderPrefix",
    );
    this.#signatureTtlSeconds = positiveSafeInteger(
      config.signatureTtlSeconds ?? DEFAULT_SIGNATURE_TTL_SECONDS,
      "Cloudinary signatureTtlSeconds",
    );
    this.#client = dependencies.client ?? defaultFacade();
    this.#now = dependencies.now ?? Date.now;
    this.#createId = dependencies.createId ?? randomUUID;
  }

  async createUploadSignature(
    input: CreateUploadSignatureInput,
  ): Promise<UploadSignature> {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Upload signature input must be an object.");
    }
    const folder = safeSegment(input.folder, "folder");
    const ownerType = safeSegment(input.ownerType, "ownerType");
    const ownerId = safeSegment(input.ownerId, "ownerId");
    const assetId = safeSegment(this.#createId(), "generated asset ID");
    const milliseconds = this.#now();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new RangeError(
        "The media-storage clock must return a safe timestamp.",
      );
    }
    const timestamp = Math.floor(milliseconds / 1000);
    const expiresAt = timestamp + this.#signatureTtlSeconds;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError("Upload signature expiry must be a safe timestamp.");
    }
    const publicId = `${this.#folderPrefix}/${folder}/${ownerType}/${ownerId}/asset-${assetId}`;
    const controlledFolder = `${this.#folderPrefix}/${folder}/${ownerType}/${ownerId}`;
    const providerParameters = Object.freeze({
      allowed_formats: [...ALLOWED_FORMATS].join(","),
      folder: controlledFolder,
      overwrite: "false",
      public_id: `asset-${assetId}`,
      timestamp,
      transformation: `c_limit,w_${VEHICLE_IMAGE_MAX_WIDTH},h_${VEHICLE_IMAGE_MAX_HEIGHT}`,
      type: "upload",
    });

    let signature: string;
    try {
      signature = this.#client.sign(providerParameters, this.#apiSecret);
    } catch (error) {
      throw new IntegrationUnavailableError(error);
    }
    if (!SIGNATURE_PATTERN.test(signature)) {
      throw new IntegrationUnavailableError();
    }

    return Object.freeze({
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.#cloudName)}/image/upload`,
      apiKey: this.#apiKey,
      publicId,
      uploadPublicId: providerParameters.public_id,
      folder: controlledFolder,
      resourceType: "image",
      allowedFormats: VEHICLE_IMAGE_ALLOWED_FORMATS,
      maxBytes: VEHICLE_IMAGE_MAX_BYTES,
      maxWidth: VEHICLE_IMAGE_MAX_WIDTH,
      maxHeight: VEHICLE_IMAGE_MAX_HEIGHT,
      transformation: providerParameters.transformation,
      timestamp,
      expiresAt,
      signature,
    });
  }

  async verifyUploadResult(result: UploadResult): Promise<VerifiedAsset> {
    if (typeof result !== "object" || result === null) {
      throw new TypeError("Upload result must be an object.");
    }
    const publicId = safePublicId(result.publicId, this.#folderPrefix);
    const version = positiveSafeInteger(result.version, "version");
    const signature = required(result.signature, "signature");
    let expected: string;
    try {
      expected = this.#client.sign(
        { public_id: publicId, version },
        this.#apiSecret,
      );
    } catch (error) {
      throw new IntegrationUnavailableError(error);
    }
    if (!equalSignature(expected, signature)) {
      throw new TypeError("Upload result could not be verified.");
    }

    let inspected: unknown;
    try {
      inspected = await this.#client.resource(publicId, {
        cloud_name: this.#cloudName,
        api_key: this.#apiKey,
        api_secret: this.#apiSecret,
        resource_type: "image",
        type: "upload",
      });
    } catch (error) {
      throw new IntegrationUnavailableError(error);
    }
    if (typeof inspected !== "object" || inspected === null) {
      throw new IntegrationUnavailableError();
    }
    const resource = inspected as Record<string, unknown>;
    if (resource.public_id !== publicId || resource.version !== version) {
      throw new TypeError("Upload result could not be verified.");
    }
    if (
      required(
        String(resource.resource_type ?? ""),
        "resourceType",
      ).toLowerCase() !== "image"
    ) {
      throw new TypeError("Only image upload results are supported.");
    }
    if (resource.type !== "upload") {
      throw new TypeError(
        "Only ordinary uploaded image resources are supported.",
      );
    }
    const width = positiveSafeInteger(resource.width as number, "width");
    const height = positiveSafeInteger(resource.height as number, "height");
    const bytes = positiveSafeInteger(resource.bytes as number, "bytes");
    if (width > VEHICLE_IMAGE_MAX_WIDTH || height > VEHICLE_IMAGE_MAX_HEIGHT) {
      throw new RangeError("Image dimensions exceed the allowed maximum.");
    }
    if (bytes > VEHICLE_IMAGE_MAX_BYTES) {
      throw new RangeError("Image file size exceeds the allowed maximum.");
    }
    const createdAt = required(String(resource.created_at ?? ""), "createdAt");
    const createdAtMilliseconds = Date.parse(createdAt);
    const nowMilliseconds = this.#now();
    if (
      !Number.isFinite(createdAtMilliseconds) ||
      !Number.isSafeInteger(nowMilliseconds) ||
      createdAtMilliseconds > nowMilliseconds + 60_000 ||
      nowMilliseconds - createdAtMilliseconds >
        COMPLETED_UPLOAD_MAX_AGE_SECONDS * 1000
    ) {
      throw new TypeError("createdAt must be a valid timestamp.");
    }

    return Object.freeze({
      publicId,
      url: safeHttpsUrl(String(resource.secure_url ?? ""), this.#cloudName),
      width,
      height,
      bytes,
      format: safeFormat(String(resource.format ?? "")),
      resourceType: "image",
      createdAt,
    });
  }

  async deleteAsset(publicId: string): Promise<DeleteOutcome> {
    const normalized = safePublicId(publicId, this.#folderPrefix);
    try {
      const response = await this.#client.destroy(normalized, {
        cloud_name: this.#cloudName,
        api_key: this.#apiKey,
        api_secret: this.#apiSecret,
        resource_type: "image",
        type: "upload",
        invalidate: true,
      });
      if (response.result === "ok") {
        return Object.freeze({ status: "deleted" });
      }
      if (response.result === "not found") {
        return Object.freeze({ status: "alreadyMissing" });
      }
      return Object.freeze({
        status: "failed",
        reason: "Media provider could not delete the asset.",
      });
    } catch {
      return Object.freeze({
        status: "failed",
        reason: "Media provider could not delete the asset.",
      });
    }
  }

  buildDeliveryUrl(publicId: string, transform?: MediaTransform): string {
    const normalized = safePublicId(publicId, this.#folderPrefix);
    const options: CloudinaryUrlOptions = Object.freeze({
      cloud_name: this.#cloudName,
      secure: true,
      resource_type: "image",
      type: "upload",
      ...normalizeTransform(transform),
    });
    try {
      const url = this.#client.url(normalized, options);
      return safeHttpsUrl(url, this.#cloudName);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError)
        throw error;
      throw new IntegrationUnavailableError(error);
    }
  }
}
