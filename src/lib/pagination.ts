/**
 * Strict public pagination contract (Phase 6).
 *
 * The public catalogue uses a fixed page size and a `page`-only URL surface;
 * search and filters are deferred to Phase 7 and must not be introduced here.
 * These helpers are pure and client-safe so route/page components and the
 * server service share one normalization and shape.
 */

/** The fixed public catalogue page size. */
export const PUBLIC_PAGE_SIZE = 12;

/** A page of already-mapped items plus deterministic navigation metadata. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
}

/**
 * Normalize a raw `page` query value to a positive integer, defaulting to 1.
 *
 * Malformed, non-integer, negative, zero, or out-of-range values all safely
 * normalize to page 1 rather than throwing, matching the route convention of
 * never surfacing a 400 for a bad page in the URL. Arrays (repeated params)
 * take their first entry.
 */
export function normalizePageParam(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 ? value : 1;
  }
  if (typeof value !== "string") return 1;
  const trimmed = value.trim();
  // Only a plain run of ASCII digits is a valid page; reject "1.5", "-1", "1e3".
  if (!/^\d+$/.test(trimmed)) return 1;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Build a {@link PaginatedResult} from a page of items and the total count.
 * `totalPages` is 0 for an empty set; navigation flags are derived so a page
 * beyond the end reports no next page and (for page > 1) a previous page.
 */
export function buildPaginatedResult<T>(input: {
  readonly items: readonly T[];
  readonly page: number;
  readonly totalItems: number;
  readonly pageSize?: number;
}): PaginatedResult<T> {
  const pageSize = input.pageSize ?? PUBLIC_PAGE_SIZE;
  const totalItems = Math.max(0, Math.trunc(input.totalItems));
  const totalPages = Math.ceil(totalItems / pageSize);
  const page = Math.max(1, Math.trunc(input.page));
  return {
    items: input.items,
    page,
    pageSize,
    totalItems,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}
