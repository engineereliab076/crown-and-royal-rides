/**
 * Best-effort client IP extraction from proxy headers.
 *
 * Behind Vercel (and most reverse proxies) the originating client address is in
 * `x-forwarded-for` (comma-separated; the first entry is the client), with
 * `x-real-ip` as a fallback. This is used only as a rate-limit dimension; it is
 * never trusted for authorization and never stored raw (it is HMAC-hashed before
 * becoming a rate-limit key). Returns `null` when no address can be determined.
 */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp !== null && realIp.trim().length > 0) return realIp.trim();

  return null;
}
