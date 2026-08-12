/**
 * Resolve a caller-supplied post-login destination to a safe internal path.
 *
 * Only same-origin absolute paths under `/admin` are accepted; anything else
 * (external URLs, protocol-relative `//host`, backslash tricks, non-admin
 * paths, or non-strings) falls back to the default. This prevents open
 * redirects: the value can only ever point back into the admin area.
 */
const DEFAULT_ADMIN_PATH = "/admin";

export function resolveSafeAdminPath(
  value: unknown,
  fallback: string = DEFAULT_ADMIN_PATH,
): string {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (candidate.length === 0) return fallback;
  if (!candidate.startsWith("/")) return fallback; // must be absolute-internal
  if (candidate.startsWith("//")) return fallback; // protocol-relative
  if (candidate.startsWith("/\\")) return fallback; // backslash smuggling
  if (candidate.includes("://")) return fallback; // embedded absolute URL
  if (candidate !== "/admin" && !candidate.startsWith("/admin/")) {
    return fallback;
  }
  return candidate;
}
