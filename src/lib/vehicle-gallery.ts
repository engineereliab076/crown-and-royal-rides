/**
 * Pure, client-safe gallery logic (Phase 4, Group 3) shared by the admin gallery
 * manager. All ordering/cover/alt rules live here as pure functions so they can
 * be unit-tested in Node without a DOM; the React component is a thin shell.
 *
 * The numeric limits mirror the server (`MAX_VEHICLE_IMAGES`, `ALT_TEXT_MAX_LENGTH`
 * in `@/server/modules/vehicle-images/schemas`); a unit test asserts they match so
 * the client and server cannot drift.
 */

export const MAX_GALLERY_IMAGES = 15;
export const ALT_TEXT_MAX_LENGTH = 160;
/** Concurrent active uploads; small so per-file progress stays meaningful. */
export const MAX_CONCURRENT_UPLOADS = 3;

export interface GalleryImage {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly isCover: boolean;
}

/** The image IDs in current display order (sortOrder ASC, id ASC tiebreak). */
export function orderedIds(images: readonly GalleryImage[]): string[] {
  return sortImages(images).map((image) => image.id);
}

function sortImages(images: readonly GalleryImage[]): GalleryImage[] {
  return [...images].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1),
  );
}

/** Apply a full reordering by ID, assigning contiguous sortOrder 0..n-1. */
export function reorderByIds(
  images: readonly GalleryImage[],
  desiredOrder: readonly string[],
): GalleryImage[] {
  const byId = new Map(images.map((image) => [image.id, image]));
  const result: GalleryImage[] = [];
  desiredOrder.forEach((id, index) => {
    const image = byId.get(id);
    if (image !== undefined) result.push({ ...image, sortOrder: index });
  });
  // Defensive: append any image not named in the desired order, preserving it.
  if (result.length !== images.length) {
    for (const image of sortImages(images)) {
      if (!desiredOrder.includes(image.id)) {
        result.push({ ...image, sortOrder: result.length });
      }
    }
  }
  return result;
}

/** Move a single image one position earlier or later; returns the new order. */
export function moveImage(
  images: readonly GalleryImage[],
  id: string,
  direction: "earlier" | "later",
): GalleryImage[] {
  const order = orderedIds(images);
  const index = order.indexOf(id);
  if (index < 0) return sortImages(images);
  const target = direction === "earlier" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return sortImages(images);
  const swapped = [...order];
  const moved = swapped[index]!;
  swapped[index] = swapped[target]!;
  swapped[target] = moved;
  return reorderByIds(images, swapped);
}

/** Whether moving this image in the given direction is possible. */
export function canMove(
  images: readonly GalleryImage[],
  id: string,
  direction: "earlier" | "later",
): boolean {
  const order = orderedIds(images);
  const index = order.indexOf(id);
  if (index < 0) return false;
  return direction === "earlier" ? index > 0 : index < order.length - 1;
}

/**
 * The cover after removing an image, mirroring the server: if the removed image
 * was the cover, the remaining image with the smallest sortOrder is promoted;
 * otherwise the cover is unchanged. Returns null when the gallery becomes empty.
 */
export function coverAfterRemoval(
  images: readonly GalleryImage[],
  removedId: string,
): string | null {
  const remaining = sortImages(images).filter(
    (image) => image.id !== removedId,
  );
  if (remaining.length === 0) return null;
  const removed = images.find((image) => image.id === removedId);
  if (removed?.isCover) return remaining[0]!.id;
  const existingCover = remaining.find((image) => image.isCover);
  return (existingCover ?? remaining[0]!).id;
}

/** Trim and validate alt text; returns the trimmed value or null if invalid. */
export function normalizeAltText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ALT_TEXT_MAX_LENGTH) return null;
  return trimmed;
}

/** A safe initial alt-text suggestion from vehicle identity plus position. */
export function suggestAltText(
  vehicle: { brandName: string; model: string; year: number },
  position: number,
): string {
  const base = `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`.trim();
  const suggestion =
    position <= 1 ? `${base} — main photo` : `${base} — photo ${position}`;
  return suggestion.slice(0, ALT_TEXT_MAX_LENGTH);
}
