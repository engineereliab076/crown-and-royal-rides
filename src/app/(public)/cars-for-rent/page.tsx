import type { Metadata } from "next";

import { CataloguePage } from "@/components/vehicles/catalogue-page";
import { normalizePageParam } from "@/lib/pagination";
import { paginatedCanonical } from "@/lib/public-metadata";
import { getCachedRentalCatalogue } from "@/server/cache/vehicles";
import { getPublicCatalogueService } from "@/server/vehicles/services";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const page = normalizePageParam((await searchParams).page);
  return {
    title: "Vehicles for rent",
    description: "Browse available and reserved rental vehicles.",
    alternates: { canonical: paginatedCanonical("/cars-for-rent", page) },
  };
}

export default async function CarsForRentPage({ searchParams }: Props) {
  const page = normalizePageParam((await searchParams).page);
  const catalogue = await getCachedRentalCatalogue(page, () =>
    getPublicCatalogueService().listRentalCatalogue(page),
  );
  return (
    <CataloguePage
      title="Vehicles for rent"
      introduction="Browse vehicles currently available or reserved for rental."
      basePath="/cars-for-rent"
      catalogue={catalogue}
      emptyTitle="No rental vehicles are available right now"
    />
  );
}
