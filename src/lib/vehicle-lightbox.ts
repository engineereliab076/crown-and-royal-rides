/**
 * Pure lightbox navigation logic (Phase 4, Group 4). Keyboard, index stepping,
 * and swipe-threshold resolution live here so they can be unit-tested without a
 * DOM; the React lightbox is a thin shell over these functions.
 */

/** Minimum horizontal travel (px) before a touch drag counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 40;

export type LightboxAction = "next" | "prev" | "close";

/** Wrap an index by `delta` within `[0, total)`. Returns 0 for an empty set. */
export function stepIndex(
  current: number,
  delta: number,
  total: number,
): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/** Map a keyboard key to a lightbox action, or null if it is not a control. */
export function lightboxKeyAction(key: string): LightboxAction | null {
  switch (key) {
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "prev";
    case "Escape":
      return "close";
    default:
      return null;
  }
}

/**
 * Resolve a horizontal swipe into a navigation action. A swipe left (negative
 * delta) advances; a swipe right goes back. Movement below the threshold is
 * ignored so a tiny accidental drag never navigates.
 */
export function resolveSwipe(
  deltaX: number,
  threshold: number = SWIPE_THRESHOLD_PX,
): "next" | "prev" | null {
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < threshold) return null;
  return deltaX < 0 ? "next" : "prev";
}

/** The index of the cover image, or 0 when none is marked. */
export function initialIndex(images: readonly { isCover: boolean }[]): number {
  const cover = images.findIndex((image) => image.isCover);
  return cover >= 0 ? cover : 0;
}
