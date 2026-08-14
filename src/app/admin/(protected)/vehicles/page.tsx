import type { Metadata } from "next";

import { VehicleListClient } from "@/components/admin/vehicle-list-client";
import { parseVehicleFilters } from "@/lib/admin-vehicle-ui";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";
import type { VehicleListInput } from "@/server/modules/vehicles/schemas";

export const metadata: Metadata = {
  title: "Vehicles",
  robots: { index: false, follow: false },
};

export default async function AdminVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminPage("content:manage");
  const actor = { id: user.id, role: user.role };
  const filters = parseVehicleFilters(await searchParams);
  const query: VehicleListInput = {
    page: filters.page,
    limit: filters.limit,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.listingState
      ? {
          listingState:
            filters.listingState as VehicleListInput["listingState"],
        }
      : {}),
    ...(filters.saleStatus
      ? { saleStatus: filters.saleStatus as VehicleListInput["saleStatus"] }
      : {}),
    ...(filters.rentalStatus
      ? {
          rentalStatus:
            filters.rentalStatus as VehicleListInput["rentalStatus"],
        }
      : {}),
    ...(filters.isForSale ? { isForSale: filters.isForSale === "true" } : {}),
    ...(filters.isForRent ? { isForRent: filters.isForRent === "true" } : {}),
    ...(filters.featured ? { featured: filters.featured === "true" } : {}),
    ...(filters.verified ? { verified: filters.verified === "true" } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
  };
  const services = getAdminServices();
  const [result, brands, featured] = await Promise.all([
    services.vehicleService.listAdmin(actor, query),
    services.brandService.list(actor),
    services.vehicleService.listAdmin(actor, {
      page: 1,
      limit: 1,
      featured: true,
    }),
  ]);

  return (
    <VehicleListClient
      initialItems={result.items}
      filters={filters}
      brands={brands}
      total={result.total}
      page={result.page}
      limit={result.limit}
      initialFeaturedCount={featured.total}
    />
  );
}
