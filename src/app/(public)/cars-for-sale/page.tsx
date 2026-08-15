import type { Metadata } from "next";

import { CataloguePage } from "@/components/vehicles/catalogue-page";
import { normalizePageParam } from "@/lib/pagination";
import { paginatedCanonical } from "@/lib/public-metadata";
import { getCachedSaleCatalogue } from "@/server/cache/vehicles";
import { getPublicCatalogueService } from "@/server/vehicles/services";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const page = normalizePageParam((await searchParams).page);
  return {
    title: "Vehicles for sale",
    description: "Browse available and reserved vehicles for sale.",
    alternates: { canonical: paginatedCanonical("/cars-for-sale", page) },
  };
}

export default async function CarsForSalePage({ searchParams }: Props) {
  const page = normalizePageParam((await searchParams).page);
  const catalogue = await getCachedSaleCatalogue(page, () =>
    getPublicCatalogueService().listSaleCatalogue(page),
  );
  return (
    <CataloguePage
      title="Vehicles for sale"
      introduction="Browse vehicles currently available or reserved for sale."
      basePath="/cars-for-sale"
      catalogue={catalogue}
      emptyTitle="No sale vehicles are available right now"
    />
  );
}
