/**
 * Pure public catalogue query parsing and contract (Phase 7, Group 1).
 *
 * This module is deliberately client-safe and database-free: it imports no
 * `server-only` code, no Prisma, and no provider SDK. It converts raw Next.js
 * search-param shapes into a strictly normalized, JSON-serializable query that
 * the repository/service consume, and it never echoes raw rejected input into
 * errors, DTOs, or `meta.ignoredFilters`.
 *
 * The same normalization also produces the canonical cache key so semantically
 * equivalent URLs share one Next.js Data Cache entry, and the `appliedFilters`
 * projection that carries only accepted normalized values back to the UI.
 */

import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  DRIVETRAINS,
  FUEL_TYPES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type BodyTypeValue,
  type DriverOptionValue,
  type DrivetrainValue,
  type FuelTypeValue,
  type TransmissionValue,
  type VehicleConditionValue,
} from "@/lib/vehicle-values";

// ── Public constants ─────────────────────────────────────────────────────────

/** The three catalogue modes and their canonical routes. */
export type VehicleMode = "all" | "sale" | "rental";

/** The public sort whitelist. `relevance` is only valid when `q` is present. */
export type VehicleSort =
  "newest" | "year_desc" | "price_asc" | "price_desc" | "relevance";

const ALL_SORTS: ReadonlySet<VehicleSort> = new Set([
  "newest",
  "year_desc",
  "price_asc",
  "price_desc",
  "relevance",
]);

/** Bounds shared with the year CHECK constraint (vehicles_year_range_check). */
export const MIN_FILTER_YEAR = 1980;
export const MAX_FILTER_YEAR = 2100;

/** Maximum normalized length of the free-text query. */
export const MAX_QUERY_LENGTH = 120;

/** Maximum length of an accepted brand slug. */
export const MAX_BRAND_SLUG_LENGTH = 80;

/** Slug grammar mirrors `slugify` output: lowercase alphanumerics + hyphens. */
const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Safe echo grammar for reporting unknown parameter names. */
const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

/** The exhaustive whitelist of supported public parameter names. */
export const SUPPORTED_FILTER_KEYS = [
  "q",
  "brand",
  "bodyType",
  "condition",
  "transmission",
  "fuelType",
  "drivetrain",
  "driverOption",
  "yearMin",
  "yearMax",
  "priceMin",
  "priceMax",
  "sort",
  "page",
] as const;

const SUPPORTED_KEY_SET: ReadonlySet<string> = new Set(SUPPORTED_FILTER_KEYS);

// ── Contract types ───────────────────────────────────────────────────────────

/** A safe, enumerated reason. Never carries a raw rejected value. */
export type IgnoredFilterReason =
  | "unknown_parameter"
  | "repeated"
  | "invalid_string"
  | "too_long"
  | "invalid_enum"
  | "invalid_slug"
  | "invalid_integer"
  | "out_of_range"
  | "invalid_price"
  | "invalid_page"
  | "not_applicable"
  | "unknown_sort"
  | "relevance_requires_query"
  | "price_sort_not_supported";

export interface IgnoredFilter {
  readonly key: string;
  readonly reason: IgnoredFilterReason;
}

/** The fully normalized, nullable filter set the repository consumes. */
export interface NormalizedVehicleFilters {
  readonly q: string | null;
  readonly brand: string | null;
  readonly bodyType: BodyTypeValue | null;
  readonly condition: VehicleConditionValue | null;
  readonly transmission: TransmissionValue | null;
  readonly fuelType: FuelTypeValue | null;
  readonly drivetrain: DrivetrainValue | null;
  readonly driverOption: DriverOptionValue | null;
  readonly yearMin: number | null;
  readonly yearMax: number | null;
  /** Whole TZS; only ever non-null in sale/rental modes. */
  readonly priceMin: number | null;
  readonly priceMax: number | null;
}

/** Only the accepted, non-null normalized filters — never raw URL input. */
export interface AppliedFilters {
  readonly q?: string;
  readonly brand?: string;
  readonly bodyType?: BodyTypeValue;
  readonly condition?: VehicleConditionValue;
  readonly transmission?: TransmissionValue;
  readonly fuelType?: FuelTypeValue;
  readonly drivetrain?: DrivetrainValue;
  readonly driverOption?: DriverOptionValue;
  readonly yearMin?: number;
  readonly yearMax?: number;
  readonly priceMin?: number;
  readonly priceMax?: number;
}

/** An ordered categorical facet bucket for the UI. */
export interface VehicleFacetOption {
  readonly value: string;
  readonly count: number;
}
/** A brand facet carries a stable slug value and a display label. */
export interface VehicleBrandFacetOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}
/** A numeric facet range. */
export interface VehicleFacetRange {
  readonly min: number;
  readonly max: number;
}
/** The complete, ordered facet set returned with a catalogue search. */
export interface VehicleFacets {
  readonly brand: readonly VehicleBrandFacetOption[];
  readonly bodyType: readonly VehicleFacetOption[];
  readonly condition: readonly VehicleFacetOption[];
  readonly transmission: readonly VehicleFacetOption[];
  readonly fuelType: readonly VehicleFacetOption[];
  readonly drivetrain: readonly VehicleFacetOption[];
  readonly driverOption: readonly VehicleFacetOption[];
  readonly year: VehicleFacetRange | null;
  /** Only present in sale/rental modes; always `null` for `all`. */
  readonly price: VehicleFacetRange | null;
}

/** The result of parsing a request's search params for a given mode. */
export interface ParsedVehicleQuery {
  readonly mode: VehicleMode;
  readonly filters: NormalizedVehicleFilters;
  readonly sort: VehicleSort;
  readonly page: number;
  readonly appliedFilters: AppliedFilters;
  readonly ignoredFilters: readonly IgnoredFilter[];
}

/** Raw Next.js search-param shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Normalized state that may be represented in a public catalogue URL. */
export interface CatalogueUrlState {
  readonly appliedFilters: AppliedFilters;
  readonly sort: VehicleSort;
  readonly page: number;
}

// ── Small pure helpers ───────────────────────────────────────────────────────

type SingleValue =
  | { readonly kind: "absent" }
  | { readonly kind: "repeated" }
  | { readonly kind: "value"; readonly value: string };

/**
 * Reduce a raw search-param entry to a single value decision. A single-element
 * array is treated as its element; two or more entries are `repeated`.
 */
function singleValue(raw: string | string[] | undefined): SingleValue {
  if (raw === undefined) return { kind: "absent" };
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { kind: "absent" };
    if (raw.length > 1) return { kind: "repeated" };
    return { kind: "value", value: raw[0] as string };
  }
  return { kind: "value", value: raw };
}

const STRICT_DIGITS = /^\d+$/;

function sanitizeUnknownKey(key: string): string {
  return SAFE_KEY_PATTERN.test(key) ? key : "unknown";
}

// ── Ignored-filter accumulation ──────────────────────────────────────────────

class IgnoredCollector {
  private readonly seen = new Set<string>();
  private readonly entries: IgnoredFilter[] = [];

  add(key: string, reason: IgnoredFilterReason): void {
    const dedupeKey = JSON.stringify([key, reason]);
    if (this.seen.has(dedupeKey)) return;
    this.seen.add(dedupeKey);
    this.entries.push({ key, reason });
  }

  /** Deterministic parameter-name order, then reason for full stability. */
  finalize(): IgnoredFilter[] {
    return [...this.entries].sort(
      (a, b) => a.key.localeCompare(b.key) || a.reason.localeCompare(b.reason),
    );
  }
}

// ── Field parsers ────────────────────────────────────────────────────────────

function parseQuery(
  raw: SingleValue,
  ignored: IgnoredCollector,
): string | null {
  if (raw.kind === "absent") return null;
  if (raw.kind === "repeated") {
    ignored.add("q", "repeated");
    return null;
  }
  if (typeof raw.value !== "string") {
    ignored.add("q", "invalid_string");
    return null;
  }
  const normalized = raw.value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_QUERY_LENGTH) {
    ignored.add("q", "too_long");
    return null;
  }
  return normalized;
}

function parseBrand(
  raw: SingleValue,
  ignored: IgnoredCollector,
): string | null {
  if (raw.kind === "absent") return null;
  if (raw.kind === "repeated") {
    ignored.add("brand", "repeated");
    return null;
  }
  const slug = raw.value.trim().toLowerCase();
  if (slug.length === 0 || slug.length > MAX_BRAND_SLUG_LENGTH) {
    ignored.add("brand", "invalid_slug");
    return null;
  }
  if (!BRAND_SLUG_PATTERN.test(slug)) {
    ignored.add("brand", "invalid_slug");
    return null;
  }
  return slug;
}

function parseEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  raw: SingleValue,
  ignored: IgnoredCollector,
): T | null {
  if (raw.kind === "absent") return null;
  if (raw.kind === "repeated") {
    ignored.add(key, "repeated");
    return null;
  }
  if ((allowed as readonly string[]).includes(raw.value)) return raw.value as T;
  ignored.add(key, "invalid_enum");
  return null;
}

/** Strict base-10 integer with a bounded range; no prefix/exponent/fraction. */
function parseBoundedYear(
  key: string,
  raw: SingleValue,
  ignored: IgnoredCollector,
): number | null {
  if (raw.kind === "absent") return null;
  if (raw.kind === "repeated") {
    ignored.add(key, "repeated");
    return null;
  }
  if (!STRICT_DIGITS.test(raw.value)) {
    ignored.add(key, "invalid_integer");
    return null;
  }
  const value = Number(raw.value);
  if (!Number.isSafeInteger(value)) {
    ignored.add(key, "invalid_integer");
    return null;
  }
  if (value < MIN_FILTER_YEAR || value > MAX_FILTER_YEAR) {
    ignored.add(key, "out_of_range");
    return null;
  }
  return value;
}

/** Strict positive safe-integer whole TZS; sale/rental modes only. */
function parsePrice(
  key: string,
  raw: SingleValue,
  ignored: IgnoredCollector,
  applicable: boolean,
): number | null {
  if (raw.kind === "absent") return null;
  if (!applicable) {
    // In `all` mode a present price parameter is reported, never validated.
    ignored.add(key, "not_applicable");
    return null;
  }
  if (raw.kind === "repeated") {
    ignored.add(key, "repeated");
    return null;
  }
  if (!STRICT_DIGITS.test(raw.value)) {
    ignored.add(key, "invalid_price");
    return null;
  }
  const value = Number(raw.value);
  if (!Number.isSafeInteger(value) || value < 1) {
    ignored.add(key, "invalid_price");
    return null;
  }
  return value;
}

function parsePage(raw: SingleValue, ignored: IgnoredCollector): number {
  if (raw.kind === "absent") return 1;
  if (raw.kind === "repeated") {
    ignored.add("page", "invalid_page");
    return 1;
  }
  if (!STRICT_DIGITS.test(raw.value)) {
    ignored.add("page", "invalid_page");
    return 1;
  }
  const value = Number(raw.value);
  if (!Number.isSafeInteger(value) || value < 1) {
    ignored.add("page", "invalid_page");
    return 1;
  }
  return value;
}

function parseSort(
  raw: SingleValue,
  mode: VehicleMode,
  hasQuery: boolean,
  ignored: IgnoredCollector,
): VehicleSort {
  if (raw.kind === "absent") return "newest";
  if (raw.kind === "repeated") {
    ignored.add("sort", "repeated");
    return "newest";
  }
  const token = raw.value as VehicleSort;
  if (!ALL_SORTS.has(token)) {
    ignored.add("sort", "unknown_sort");
    return "newest";
  }
  if ((token === "price_asc" || token === "price_desc") && mode === "all") {
    ignored.add("sort", "price_sort_not_supported");
    return "newest";
  }
  if (token === "relevance" && !hasQuery) {
    ignored.add("sort", "relevance_requires_query");
    return "newest";
  }
  return token;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse raw Next.js search params into a strictly normalized catalogue query.
 * Pure and side-effect free: safe to call in any runtime, including on the
 * server before database access, without leaking rejected values.
 */
export function parseVehicleFilters(
  searchParams: RawSearchParams,
  mode: VehicleMode,
): ParsedVehicleQuery {
  const ignored = new IgnoredCollector();
  const priceApplicable = mode !== "all";

  const q = parseQuery(singleValue(searchParams.q), ignored);
  const brand = parseBrand(singleValue(searchParams.brand), ignored);
  const bodyType = parseEnum(
    "bodyType",
    BODY_TYPES,
    singleValue(searchParams.bodyType),
    ignored,
  );
  const condition = parseEnum(
    "condition",
    VEHICLE_CONDITIONS,
    singleValue(searchParams.condition),
    ignored,
  );
  const transmission = parseEnum(
    "transmission",
    TRANSMISSIONS,
    singleValue(searchParams.transmission),
    ignored,
  );
  const fuelType = parseEnum(
    "fuelType",
    FUEL_TYPES,
    singleValue(searchParams.fuelType),
    ignored,
  );
  const drivetrain = parseEnum(
    "drivetrain",
    DRIVETRAINS,
    singleValue(searchParams.drivetrain),
    ignored,
  );
  const driverOption = parseEnum(
    "driverOption",
    DRIVER_OPTIONS,
    singleValue(searchParams.driverOption),
    ignored,
  );

  let yearMin = parseBoundedYear(
    "yearMin",
    singleValue(searchParams.yearMin),
    ignored,
  );
  let yearMax = parseBoundedYear(
    "yearMax",
    singleValue(searchParams.yearMax),
    ignored,
  );
  if (yearMin !== null && yearMax !== null && yearMin > yearMax) {
    [yearMin, yearMax] = [yearMax, yearMin];
  }

  let priceMin = parsePrice(
    "priceMin",
    singleValue(searchParams.priceMin),
    ignored,
    priceApplicable,
  );
  let priceMax = parsePrice(
    "priceMax",
    singleValue(searchParams.priceMax),
    ignored,
    priceApplicable,
  );
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    [priceMin, priceMax] = [priceMax, priceMin];
  }

  const sort = parseSort(
    singleValue(searchParams.sort),
    mode,
    q !== null,
    ignored,
  );
  const page = parsePage(singleValue(searchParams.page), ignored);

  for (const key of Object.keys(searchParams)) {
    if (!SUPPORTED_KEY_SET.has(key)) {
      ignored.add(sanitizeUnknownKey(key), "unknown_parameter");
    }
  }

  const filters: NormalizedVehicleFilters = {
    q,
    brand,
    bodyType,
    condition,
    transmission,
    fuelType,
    drivetrain,
    driverOption,
    yearMin,
    yearMax,
    priceMin,
    priceMax,
  };

  return {
    mode,
    filters,
    sort,
    page,
    appliedFilters: toAppliedFilters(filters),
    ignoredFilters: ignored.finalize(),
  };
}

/** Project the accepted, non-null normalized filters. Deterministic key order. */
export function toAppliedFilters(
  filters: NormalizedVehicleFilters,
): AppliedFilters {
  const applied: Record<string, string | number> = {};
  if (filters.q !== null) applied.q = filters.q;
  if (filters.brand !== null) applied.brand = filters.brand;
  if (filters.bodyType !== null) applied.bodyType = filters.bodyType;
  if (filters.condition !== null) applied.condition = filters.condition;
  if (filters.transmission !== null)
    applied.transmission = filters.transmission;
  if (filters.fuelType !== null) applied.fuelType = filters.fuelType;
  if (filters.drivetrain !== null) applied.drivetrain = filters.drivetrain;
  if (filters.driverOption !== null)
    applied.driverOption = filters.driverOption;
  if (filters.yearMin !== null) applied.yearMin = filters.yearMin;
  if (filters.yearMax !== null) applied.yearMax = filters.yearMax;
  if (filters.priceMin !== null) applied.priceMin = filters.priceMin;
  if (filters.priceMax !== null) applied.priceMax = filters.priceMax;
  return applied as AppliedFilters;
}

/**
 * Deterministic canonical cache identity for a normalized query. Semantically
 * equivalent URLs (same normalized values) produce the same string; only
 * normalized values are included, never raw or ignored input.
 */
export function canonicalCatalogueCacheKey(input: {
  readonly mode: VehicleMode;
  readonly filters: NormalizedVehicleFilters;
  readonly sort: VehicleSort;
  readonly page: number;
  readonly pageSize: number;
}): string {
  const { mode, filters, sort, page, pageSize } = input;
  return JSON.stringify({
    version: 2,
    mode,
    filters: {
      q: filters.q,
      brand: filters.brand,
      bodyType: filters.bodyType,
      condition: filters.condition,
      transmission: filters.transmission,
      fuelType: filters.fuelType,
      drivetrain: filters.drivetrain,
      driverOption: filters.driverOption,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
    },
    sort,
    page,
    pageSize,
  });
}

/**
 * Serialize normalized public state in the one canonical URL order. Defaults
 * are omitted and rejected/raw request values cannot enter this boundary.
 */
export function serializeCatalogueState(input: CatalogueUrlState): string {
  const { appliedFilters, sort, page } = input;
  const params = new URLSearchParams();
  const append = (key: keyof AppliedFilters) => {
    const value = appliedFilters[key];
    if (value !== undefined) params.set(key, String(value));
  };

  append("q");
  append("brand");
  append("bodyType");
  append("condition");
  append("transmission");
  append("fuelType");
  append("drivetrain");
  append("driverOption");
  append("yearMin");
  append("yearMax");
  append("priceMin");
  append("priceMax");
  if (sort !== "newest") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

/** Build a pathname plus deterministic normalized query string. */
export function catalogueHref(
  pathname: string,
  input: CatalogueUrlState,
): string {
  const query = serializeCatalogueState(input);
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}
