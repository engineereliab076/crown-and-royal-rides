export interface CreateUploadSignatureInput {
  readonly folder: string;
  readonly ownerType: string;
  readonly ownerId: string;
}

export interface UploadSignature {
  readonly uploadUrl: string;
  readonly apiKey: string;
  readonly publicId: string;
  readonly uploadPublicId: string;
  readonly folder: string;
  readonly resourceType: "image";
  readonly allowedFormats: readonly string[];
  readonly maxBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly transformation: string;
  readonly timestamp: number;
  readonly expiresAt: number;
  readonly signature: string;
}

export interface UploadResult {
  readonly publicId: string;
  /** Provider asset version used when verifying the upload response signature. */
  readonly version: number;
  readonly signature: string;
}

export interface VerifiedAsset {
  readonly publicId: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly format: string;
  readonly resourceType: "image";
  readonly createdAt: string;
}

export type DeleteOutcome =
  | Readonly<{ status: "deleted" }>
  | Readonly<{ status: "alreadyMissing" }>
  | Readonly<{ status: "failed"; reason: string }>;

export type MediaFitMode = "cover" | "contain" | "fill" | "fit" | "scale";

export interface MediaTransform {
  readonly width?: number;
  readonly height?: number;
  readonly fit?: MediaFitMode;
  readonly quality?: number;
  readonly format?: string;
  readonly devicePixelRatio?: number;
}
