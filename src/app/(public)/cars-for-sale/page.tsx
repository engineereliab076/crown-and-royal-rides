import type { Metadata } from "next";

import { CataloguePage } from "@/components/vehicles/catalogue-page";
import { parseVehicleFilters } from "@/lib/vehicle-filters";
import { catalogueMetadata } from "@/lib/public-metadata";
import { searchPublicCatalogue } from "@/server/vehicles/services";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const parsed = parseVehicleFilters(await searchParams, "sale");
  return catalogueMetadata({
    path: "/cars-for-sale",
    title: "Vehicles for sale",
    description: "Browse available and reserved vehicles for sale.",
    parsed,
  });
}

export default async function CarsForSalePage({ searchParams }: Props) {
  const parsed = parseVehicleFilters(await searchParams, "sale");
  const catalogue = await searchPublicCatalogue(parsed);
  return (
    <CataloguePage
      title="Vehicles for sale"
      introduction="Browse vehicles currently available or reserved for sale."
      basePath="/cars-for-sale"
      catalogue={catalogue}
      emptyTitle="No sale vehicles are available right now"
      mode="sale"
    />
  );
}
