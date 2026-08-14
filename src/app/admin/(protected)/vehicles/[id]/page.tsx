import type { Metadata } from "next";

import { VehicleDetailClient } from "@/components/admin/vehicle-detail-client";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Vehicle detail",
  robots: { index: false, follow: false },
};

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdminPage("content:manage");
  const actor = { id: user.id, role: user.role };
  const { id } = await params;
  const services = getAdminServices();
  const [vehicle, gallery, featured] = await Promise.all([
    services.vehicleService.getAdminById(actor, id),
    services.vehicleImageService.getGallery(actor, { vehicleId: id }),
    services.vehicleService.listAdmin(actor, {
      page: 1,
      limit: 1,
      featured: true,
    }),
  ]);

  return (
    <VehicleDetailClient
      initialVehicle={vehicle}
      initialGallery={gallery}
      featuredCount={featured.total}
    />
  );
}
