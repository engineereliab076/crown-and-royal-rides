import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/public-metadata";
import { getCachedSitemapVehicleSlugs } from "@/server/cache/vehicles";
import { getPublicCatalogueService } from "@/server/vehicles/services";

export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/cars",
  "/cars-for-sale",
  "/cars-for-rent",
  "/about",
  "/contact",
  "/privacy",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getCachedSitemapVehicleSlugs(() =>
    getPublicCatalogueService().listIndexableSlugs(),
  );
  return [
    ...STATIC_PATHS.map((path) => ({ url: publicUrl(path).toString() })),
    ...slugs.map((slug) => ({ url: publicUrl(`/cars/${slug}`).toString() })),
  ];
}
