/**
 * Client-safe Cloudinary delivery loader (Phase 4, Group 4).
 *
 * A `next/image` loader that inserts a fixed, safe transformation into a verified
 * Cloudinary delivery URL. It accepts only the exact HTTPS `res.cloudinary.com`
 * `/image/upload/` structure that the server-verified `secureUrl` uses; anything
 * else is returned unchanged (never rewritten), so it cannot be used to inject
 * arbitrary transformations or point at another host. No API credential,
 * signature, or public ID is ever added — only `f_auto`, `q_auto`, a limit crop,
 * and a clamped width.
 */

/** The responsive width ladder; requested widths are clamped up to these. */
export const CLOUDINARY_WIDTH_LADDER = [
  320, 480, 640, 768, 960, 1200, 1600, 2000, 2400,
] as const;

const UPLOAD_MARKER = "/image/upload/";
// A safe transformation segment: only the fixed directives plus a numeric width.
const EXISTING_TRANSFORM = /^[a-z]{1,3}_[^/]+(,[a-z]{1,3}_[^/]+)*$/;

/** Clamp a requested width up to the nearest ladder rung (max 2400). */
export function clampWidth(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    return CLOUDINARY_WIDTH_LADDER[0];
  }
  for (const rung of CLOUDINARY_WIDTH_LADDER) {
    if (requested <= rung) return rung;
  }
  return CLOUDINARY_WIDTH_LADDER[CLOUDINARY_WIDTH_LADDER.length - 1]!;
}

function isVerifiedCloudinaryUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "res.cloudinary.com" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname.includes(UPLOAD_MARKER)
  );
}

export interface CloudinaryLoaderArgs {
  readonly src: string;
  readonly width: number;
  readonly quality?: number;
}

/**
 * Rewrite a verified Cloudinary URL to request a clamped, auto-format,
 * auto-quality, limit-cropped rendition. Returns the input unchanged when it is
 * not the exact verified Cloudinary delivery structure.
 */
export function cloudinaryLoader({ src, width }: CloudinaryLoaderArgs): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (!isVerifiedCloudinaryUrl(url)) return src;

  const markerIndex = url.pathname.indexOf(UPLOAD_MARKER);
  const prefix = url.pathname.slice(0, markerIndex + UPLOAD_MARKER.length);
  let remainder = url.pathname.slice(markerIndex + UPLOAD_MARKER.length);

  // If a transformation segment is already present (defense in depth), drop it
  // rather than stack an attacker-supplied one on top.
  const firstSegment = remainder.split("/")[0] ?? "";
  if (EXISTING_TRANSFORM.test(firstSegment) && !/^v\d+$/.test(firstSegment)) {
    remainder = remainder.slice(firstSegment.length + 1);
  }

  const transformation = `f_auto,q_auto,c_limit,w_${clampWidth(width)}`;
  return `${url.origin}${prefix}${transformation}/${remainder}`;
}
