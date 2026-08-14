import "server-only";

/**
 * Public/administrative image DTO for the gallery.
 *
 * Only safe, display-relevant metadata is exposed. Provider signatures, API
 * keys, the raw provider `public_id`/`byte_size`, upload envelopes, and every
 * deletion-queue record are deliberately absent: the mapper builds the DTO from
 * an explicit field list rather than spreading a database record, so an internal
 * field can never leak by accident.
 */
export interface VehicleImageDTO {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly isCover: boolean;
  readonly createdAt: string;
}

/** The internal, server-only image shape a repository read returns. */
export interface VehicleImageRecord {
  readonly id: string;
  readonly publicId: string;
  readonly secureUrl: string;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly isCover: boolean;
  readonly createdAt: Date;
}

export function toVehicleImageDTO(image: VehicleImageRecord): VehicleImageDTO {
  return {
    id: image.id,
    url: image.secureUrl,
    width: image.width,
    height: image.height,
    format: image.format,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isCover: image.isCover,
    createdAt: image.createdAt.toISOString(),
  };
}

export function toVehicleImageDTOList(
  images: readonly VehicleImageRecord[],
): readonly VehicleImageDTO[] {
  return images.map(toVehicleImageDTO);
}

/** A reorder/mutation result: the fresh ordered gallery plus the parent stamp. */
export interface VehicleGalleryDTO {
  readonly images: readonly VehicleImageDTO[];
  readonly updatedAt: string;
}
