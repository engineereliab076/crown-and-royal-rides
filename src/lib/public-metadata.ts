import "server-only";

import type { Metadata } from "next";

import { env } from "@/lib/env";
import { catalogueHref, type ParsedVehicleQuery } from "@/lib/vehicle-filters";
import { siteConfig } from "@/lib/site";
import type { PublicVehicleDetailResult } from "@/server/modules/vehicles/public-dto";

export function publicUrl(path: string): URL {
  return new URL(path, env.NEXT_PUBLIC_APP_URL);
}

export function paginatedCanonical(path: string, page: number): URL {
  const url = publicUrl(path);
  if (page > 1) url.searchParams.set("page", String(page));
  return url;
}

export function publicPageMetadata(input: {
  readonly path: string;
  readonly title: string;
  readonly description: string;
}): Metadata {
  const url = publicUrl(input.path);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: input.title,
      description: input.description,
      url,
    },
  };
}

/** Metadata for a normalized catalogue state; ignored values never appear. */
export function catalogueMetadata(input: {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly parsed: ParsedVehicleQuery;
}): Metadata {
  const normalizedPath = catalogueHref(input.path, {
    appliedFilters: input.parsed.appliedFilters,
    sort: input.parsed.sort,
    page: input.parsed.page,
  });
  const canonical = publicUrl(normalizedPath);
  const hasFilteredState =
    Object.keys(input.parsed.appliedFilters).length > 0 ||
    input.parsed.sort !== "newest" ||
    input.parsed.page > 1;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    robots: { index: !hasFilteredState, follow: true },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: input.title,
      description: input.description,
      url: canonical,
    },
  };
}

/** Detail metadata from the resolved public DTO and centralized robots state. */
export function vehicleDetailMetadata(
  result: PublicVehicleDetailResult,
): Metadata {
  const { vehicle, robots, presentation } = result;
  const title = `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`;
  const suffix =
    presentation.state === "sold-historical"
      ? " — sold"
      : presentation.state === "retired"
        ? " — no longer available"
        : presentation.state === "unavailable"
          ? " — unavailable"
          : "";
  const fullTitle = `${title}${suffix}`;
  const description =
    vehicle.description?.trim() || `${title} from Crown and Royal Rides.`;
  const canonical = publicUrl(`/cars/${vehicle.slug}`);
  const cover = vehicle.coverImage;
  return {
    title: fullTitle,
    description,
    robots: { index: robots.index, follow: robots.follow },
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: fullTitle,
      description,
      url: canonical,
      images: cover
        ? [
            {
              url: cover.url,
              width: cover.width,
              height: cover.height,
              alt: cover.altText,
            },
          ]
        : undefined,
    },
  };
}
