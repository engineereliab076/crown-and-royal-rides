import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import { PUBLIC_PAGE_SIZE } from "@/lib/pagination";
import {
  canonicalCatalogueCacheKey,
  type VehicleMode,
} from "@/lib/vehicle-filters";
import type { VehiclePublicDetailDTO } from "@/server/modules/vehicles/dto";
import type {
  NormalizedCatalogueQuery,
  NormalizedCatalogueResult,
  PublicVehicleCard,
  PublicVehicleDetailResult,
  PublicVehiclePage,
} from "@/server/modules/vehicles/public-dto";

const VEHICLE_REVALIDATE_SECONDS = 300;

// ── Stable cache tags ────────────────────────────────────────────────────────

/** Catalogue-wide tag: any change that can alter the active `/cars` listing. */
export const VEHICLE_CATALOGUE_TAG = "vehicles:catalogue";
/** Sale catalogue tag. */
export const VEHICLE_SALE_TAG = "vehicles:sale";
/** Rental catalogue tag. */
export const VEHICLE_RENTAL_TAG = "vehicles:rental";
/** Featured rail tag. */
export const VEHICLE_FEATURED_TAG = "vehicles:featured";

/** The per-vehicle slug tag (stable, deterministic). */
export function vehicleCacheTag(slug: string): string {
  return `vehicle:${slug}`;
}

/** Every catalogue-scoped tag, so a broad mutation refreshes all listings. */
export const VEHICLE_CATALOGUE_TAGS = [
  VEHICLE_CATALOGUE_TAG,
  VEHICLE_SALE_TAG,
  VEHICLE_RENTAL_TAG,
  VEHICLE_FEATURED_TAG,
] as const;

// ── Revalidation ─────────────────────────────────────────────────────────────

/** Revalidate every catalogue-scoped listing (bounded, no per-slug fan-out). */
export function revalidateCatalogue(): void {
  for (const tag of VEHICLE_CATALOGUE_TAGS) revalidateTag(tag);
}

/** Revalidate only a single vehicle's detail (and any listing that embeds it). */
export function revalidateVehicle(slug: string): void {
  revalidateTag(vehicleCacheTag(slug));
}

/**
 * Revalidate a public-affecting mutation for a known slug: the specific detail
 * page plus every catalogue listing it can appear in. Detail caches are also
 * tagged with the catalogue tag, so this refreshes related rails everywhere.
 */
export function revalidatePublicVehicle(slug: string): void {
  revalidateVehicle(slug);
  revalidateCatalogue();
}

// ── Parameterized caches ─────────────────────────────────────────────────────
//
// Every cache key includes the discriminating argument (page or slug) so two
// different pages/slugs never share a cached result. Catalogue pages carry the
// relevant catalogue tags; the detail cache carries its per-slug tag AND the
// catalogue tag so a broad change (e.g. a brand rename) refreshes detail pages.

/** @deprecated Legacy single-vehicle cache retained for the Phase 5 boundary. */
export async function getCachedPublicVehicle(
  slug: string,
  load: () => Promise<VehiclePublicDetailDTO>,
): Promise<VehiclePublicDetailDTO> {
  return unstable_cache(load, ["public-vehicle", slug], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [vehicleCacheTag(slug)],
  })();
}

export async function getCachedPublicVehicleDetail(
  slug: string,
  load: () => Promise<PublicVehicleDetailResult>,
): Promise<PublicVehicleDetailResult> {
  return unstable_cache(load, ["public-vehicle-detail", slug], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [vehicleCacheTag(slug), VEHICLE_CATALOGUE_TAG],
  })();
}

export async function getCachedActiveCatalogue(
  page: number,
  load: () => Promise<PublicVehiclePage>,
): Promise<PublicVehiclePage> {
  return unstable_cache(load, ["public-catalogue-active", String(page)], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_CATALOGUE_TAG],
  })();
}

export async function getCachedSaleCatalogue(
  page: number,
  load: () => Promise<PublicVehiclePage>,
): Promise<PublicVehiclePage> {
  return unstable_cache(load, ["public-catalogue-sale", String(page)], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_SALE_TAG],
  })();
}

export async function getCachedRentalCatalogue(
  page: number,
  load: () => Promise<PublicVehiclePage>,
): Promise<PublicVehiclePage> {
  return unstable_cache(load, ["public-catalogue-rental", String(page)], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_RENTAL_TAG],
  })();
}

/** The catalogue tag that revalidates a mode's cached search results. */
function tagForMode(mode: VehicleMode): string {
  if (mode === "sale") return VEHICLE_SALE_TAG;
  if (mode === "rental") return VEHICLE_RENTAL_TAG;
  return VEHICLE_CATALOGUE_TAG;
}

/**
 * Cache a normalized catalogue search. Cache identity is the deterministic
 * canonical key over mode, normalized filters, sort, page, and the fixed page
 * size — never raw URL input and never the request-specific ignored-filter
 * report. Semantically equivalent URLs therefore share one data-cache entry.
 */
export async function getCachedVehicleSearch(
  query: NormalizedCatalogueQuery,
  load: () => Promise<NormalizedCatalogueResult>,
): Promise<NormalizedCatalogueResult> {
  const key = canonicalCatalogueCacheKey({
    mode: query.mode,
    filters: query.filters,
    sort: query.sort,
    page: query.page,
    pageSize: PUBLIC_PAGE_SIZE,
  });
  return unstable_cache(load, ["public-vehicle-search", key], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [tagForMode(query.mode)],
  })();
}

export async function getCachedFeatured(
  load: () => Promise<readonly PublicVehicleCard[]>,
): Promise<readonly PublicVehicleCard[]> {
  return unstable_cache(load, ["public-featured"], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_FEATURED_TAG],
  })();
}

export async function getCachedSaleStrip(
  load: () => Promise<readonly PublicVehicleCard[]>,
): Promise<readonly PublicVehicleCard[]> {
  return unstable_cache(load, ["public-sale-strip"], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_SALE_TAG],
  })();
}

export async function getCachedRentalStrip(
  load: () => Promise<readonly PublicVehicleCard[]>,
): Promise<readonly PublicVehicleCard[]> {
  return unstable_cache(load, ["public-rental-strip"], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_RENTAL_TAG],
  })();
}

/** Five-minute sitemap state, invalidated by the catalogue mutation tag. */
export async function getCachedSitemapVehicleSlugs(
  load: () => Promise<readonly string[]>,
): Promise<readonly string[]> {
  return unstable_cache(load, ["public-vehicle-sitemap"], {
    revalidate: VEHICLE_REVALIDATE_SECONDS,
    tags: [VEHICLE_CATALOGUE_TAG],
  })();
}
