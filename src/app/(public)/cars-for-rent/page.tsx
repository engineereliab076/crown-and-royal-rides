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
  const parsed = parseVehicleFilters(await searchParams, "rental");
  return catalogueMetadata({
    path: "/cars-for-rent",
    title: "Vehicles for rent",
    description: "Browse available and reserved rental vehicles.",
    parsed,
  });
}

export default async function CarsForRentPage({ searchParams }: Props) {
  const parsed = parseVehicleFilters(await searchParams, "rental");
  const catalogue = await searchPublicCatalogue(parsed);
  return (
    <CataloguePage
      title="Vehicles for rent"
      introduction="Browse vehicles currently available or reserved for rental."
      basePath="/cars-for-rent"
      catalogue={catalogue}
      emptyTitle="No rental vehicles are available right now"
      mode="rental"
    />
  );
}
