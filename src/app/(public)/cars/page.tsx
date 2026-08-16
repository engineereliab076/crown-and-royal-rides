import type { Metadata } from "next";
import { Suspense } from "react";

import { CataloguePage } from "@/components/vehicles/catalogue-page";
import { CatalogueLoadingScreen } from "@/components/vehicles/catalogue-loading";
import {
  parseVehicleFilters,
  serializeCatalogueState,
} from "@/lib/vehicle-filters";
import { catalogueMetadata } from "@/lib/public-metadata";
import { searchPublicCatalogue } from "@/server/vehicles/services";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const parsed = parseVehicleFilters(await searchParams, "all");
  return catalogueMetadata({
    path: "/cars",
    title: "All vehicles",
    description:
      "Browse currently usable published vehicles for sale and rent.",
    parsed,
  });
}

// A page-level `<Suspense>` (not a route `loading.tsx`) provides the skeleton so
// the sibling detail route `/cars/[slug]` keeps no loading boundary in its
// ancestry and can therefore still return a hard 404 for missing/draft slugs.
async function CarsCatalogue({
  parsed,
}: {
  parsed: ReturnType<typeof parseVehicleFilters>;
}) {
  const catalogue = await searchPublicCatalogue(parsed);
  return (
    <CataloguePage
      title="All vehicles"
      introduction="Explore all currently usable published vehicles available through Crown and Royal Rides."
      basePath="/cars"
      catalogue={catalogue}
      emptyTitle="No vehicles are available right now"
      mode="all"
    />
  );
}

export default async function CarsPage({ searchParams }: Props) {
  const parsed = parseVehicleFilters(await searchParams, "all");
  return (
    <Suspense
      key={serializeCatalogueState(parsed)}
      fallback={<CatalogueLoadingScreen />}
    >
      <CarsCatalogue parsed={parsed} />
    </Suspense>
  );
}
