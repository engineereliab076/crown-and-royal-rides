import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { VehicleMode, VehicleSort } from "@/lib/vehicle-filters";
import type { NormalizedVehicleFilters } from "@/lib/vehicle-filters";

/**
 * Parameterized SQL fragment builders for the public catalogue search (Phase 7,
 * Group 1).
 *
 * Every dynamic value is bound through a Prisma tagged-template placeholder —
 * this module never interpolates a URL value, sort token, or enum label into a
 * SQL string. Enum labels used in the fixed catalogue predicate are compile-time
 * constants (never request input), so they are written as literal SQL. Sort and
 * facet-dimension choices are selected only from internal whitelist maps.
 *
 * The generated `search_text` / `search_vector` columns and their GIN indexes
 * (0002) back full-text and trigram matching; the request never changes the
 * database trigram threshold.
 */

/** A single categorical facet dimension. */
export type FacetDimension =
  | "brand"
  | "bodyType"
  | "condition"
  | "transmission"
  | "fuelType"
  | "drivetrain"
  | "driverOption";

/**
 * The fixed catalogue availability predicate per mode. Enum labels are
 * constants; `v` is the vehicles alias. Mirrors the Phase 6 Prisma fragments
 * (`saleUsableWhere` / `rentalUsableWhere` / `activeWhere`) exactly.
 */
export function modePredicateSql(mode: VehicleMode): Prisma.Sql {
  const saleUsable = Prisma.sql`(v.is_for_sale = true AND v.sale_status IN ('available', 'reserved') AND v.sale_price > 0)`;
  const rentalUsable = Prisma.sql`(v.is_for_rent = true AND v.rental_status IN ('available', 'reserved') AND v.rental_daily_price > 0 AND v.min_rental_days >= 1)`;
  if (mode === "sale") {
    return Prisma.sql`v.listing_state = 'published' AND ${saleUsable}`;
  }
  if (mode === "rental") {
    return Prisma.sql`v.listing_state = 'published' AND ${rentalUsable}`;
  }
  return Prisma.sql`v.listing_state = 'published' AND (${saleUsable} OR ${rentalUsable})`;
}

/**
 * Build the array of bound filter predicates, optionally excluding one facet
 * dimension (for self-excluded facet counts). The `q` search predicate is added
 * separately by the caller so the tsquery alias is only introduced when needed.
 */
export function filterPredicatesSql(
  mode: VehicleMode,
  filters: NormalizedVehicleFilters,
  options: { readonly exclude?: FacetDimension } = {},
): Prisma.Sql[] {
  const predicates: Prisma.Sql[] = [];
  const { exclude } = options;

  if (filters.brand !== null && exclude !== "brand") {
    predicates.push(
      Prisma.sql`EXISTS (SELECT 1 FROM brands b WHERE b.id = v.brand_id AND b.slug = ${filters.brand})`,
    );
  }
  if (filters.bodyType !== null && exclude !== "bodyType") {
    predicates.push(Prisma.sql`v.body_type = ${filters.bodyType}::body_type`);
  }
  if (filters.condition !== null && exclude !== "condition") {
    predicates.push(
      Prisma.sql`v.condition = ${filters.condition}::vehicle_condition`,
    );
  }
  if (filters.transmission !== null && exclude !== "transmission") {
    predicates.push(
      Prisma.sql`v.transmission = ${filters.transmission}::transmission`,
    );
  }
  if (filters.fuelType !== null && exclude !== "fuelType") {
    predicates.push(Prisma.sql`v.fuel_type = ${filters.fuelType}::fuel_type`);
  }
  if (filters.drivetrain !== null && exclude !== "drivetrain") {
    predicates.push(
      Prisma.sql`v.drivetrain = ${filters.drivetrain}::drivetrain`,
    );
  }
  if (filters.driverOption !== null && exclude !== "driverOption") {
    predicates.push(
      Prisma.sql`v.driver_option = ${filters.driverOption}::driver_option`,
    );
  }
  // Year and price bounds are their own dimensions and always remain applied to
  // categorical facet counts.
  if (filters.yearMin !== null) {
    predicates.push(Prisma.sql`v.year >= ${filters.yearMin}`);
  }
  if (filters.yearMax !== null) {
    predicates.push(Prisma.sql`v.year <= ${filters.yearMax}`);
  }
  if (mode === "sale") {
    if (filters.priceMin !== null) {
      predicates.push(Prisma.sql`v.sale_price >= ${BigInt(filters.priceMin)}`);
    }
    if (filters.priceMax !== null) {
      predicates.push(Prisma.sql`v.sale_price <= ${BigInt(filters.priceMax)}`);
    }
  } else if (mode === "rental") {
    if (filters.priceMin !== null) {
      predicates.push(
        Prisma.sql`v.rental_daily_price >= ${BigInt(filters.priceMin)}`,
      );
    }
    if (filters.priceMax !== null) {
      predicates.push(
        Prisma.sql`v.rental_daily_price <= ${BigInt(filters.priceMax)}`,
      );
    }
  }

  return predicates;
}

/**
 * The search matching predicate: full-text OR trigram similarity against bound
 * query text. `query` is the tsquery alias introduced in the FROM clause.
 *
 * Trigram tolerance uses the `%` operator, backed by
 * `vehicles_search_text_trgm_idx` and consulting the database's default
 * similarity threshold (which the request never changes). Combined with the
 * full-text match by OR, this recovers close typos while keeping the predicate
 * cheap enough to also run inside every facet query at seeded volume — the
 * heavier `<%` word-similarity operator roughly doubled per-query cost for a
 * marginal recall gain and was intentionally dropped after benchmarking.
 */
export function searchMatchSql(q: string): Prisma.Sql {
  return Prisma.sql`(v.search_vector @@ query OR v.search_text % ${q})`;
}

/** The FROM clause; introduces the tsquery alias only when searching. */
export function fromClauseSql(q: string | null): Prisma.Sql {
  if (q === null) return Prisma.sql`FROM vehicles v`;
  return Prisma.sql`FROM vehicles v, websearch_to_tsquery('english', ${q}) query`;
}

/**
 * Compose the full WHERE body (without the `WHERE` keyword) from the mode
 * predicate, the filter predicates, and — when searching — the match predicate.
 */
export function composeWhereSql(
  mode: VehicleMode,
  filters: NormalizedVehicleFilters,
  options: {
    readonly exclude?: FacetDimension;
    readonly includeSearch?: boolean;
  } = {},
): Prisma.Sql {
  const parts: Prisma.Sql[] = [modePredicateSql(mode)];
  parts.push(
    ...filterPredicatesSql(mode, filters, { exclude: options.exclude }),
  );
  if (options.includeSearch && filters.q !== null) {
    parts.push(searchMatchSql(filters.q));
  }
  return Prisma.join(parts, " AND ");
}

/**
 * Deterministic ORDER BY for the listing query. Selected only from the internal
 * whitelist; always ends in `v.id ASC` for a total, gap-free order. Price sorts
 * use the mode-appropriate column and are never reachable in `all` mode (the
 * parser demotes them to `newest`).
 */
export function orderBySql(
  mode: VehicleMode,
  sort: VehicleSort,
  q: string | null,
): Prisma.Sql {
  switch (sort) {
    case "year_desc":
      return Prisma.sql`ORDER BY v.year DESC, v.published_at DESC, v.id ASC`;
    case "price_asc":
      return mode === "rental"
        ? Prisma.sql`ORDER BY v.rental_daily_price ASC, v.id ASC`
        : Prisma.sql`ORDER BY v.sale_price ASC, v.id ASC`;
    case "price_desc":
      return mode === "rental"
        ? Prisma.sql`ORDER BY v.rental_daily_price DESC, v.id ASC`
        : Prisma.sql`ORDER BY v.sale_price DESC, v.id ASC`;
    case "relevance":
      // Only reachable when q is present (parser enforces this): rank by
      // full-text score, then trigram similarity, then recency, then id.
      return Prisma.sql`ORDER BY ts_rank_cd(v.search_vector, query) DESC, similarity(v.search_text, ${q ?? ""}) DESC, v.published_at DESC, v.id ASC`;
    case "newest":
    default:
      return Prisma.sql`ORDER BY v.published_at DESC, v.id ASC`;
  }
}
