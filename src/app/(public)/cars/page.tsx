import type { Metadata } from "next";
import { Suspense } from "react";

import { CataloguePage } from "@/components/vehicles/catalogue-page";
import { CatalogueLoadingScreen } from "@/components/vehicles/catalogue-loading";
import { normalizePageParam } from "@/lib/pagination";
import { paginatedCanonical } from "@/lib/public-metadata";
import { getCachedActiveCatalogue } from "@/server/cache/vehicles";
import { getPublicCatalogueService } from "@/server/vehicles/services";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const page = normalizePageParam((await searchParams).page);
  return {
    title: "All vehicles",
    description:
      "Browse currently usable published vehicles for sale and rent.",
    alternates: { canonical: paginatedCanonical("/cars", page) },
  };
}

// A page-level `<Suspense>` (not a route `loading.tsx`) provides the skeleton so
// the sibling detail route `/cars/[slug]` keeps no loading boundary in its
// ancestry and can therefore still return a hard 404 for missing/draft slugs.
async function CarsCatalogue({ page }: { page: number }) {
  const catalogue = await getCachedActiveCatalogue(page, () =>
    getPublicCatalogueService().listActiveCatalogue(page),
  );
  return (
    <CataloguePage
      title="All vehicles"
      introduction="Explore all currently usable published vehicles available through Crown and Royal Rides."
      basePath="/cars"
      catalogue={catalogue}
      emptyTitle="No vehicles are available right now"
    />
  );
}

export default async function CarsPage({ searchParams }: Props) {
  const page = normalizePageParam((await searchParams).page);
  return (
    <Suspense key={page} fallback={<CatalogueLoadingScreen />}>
      <CarsCatalogue page={page} />
    </Suspense>
  );
}
