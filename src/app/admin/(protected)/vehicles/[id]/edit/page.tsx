import type { Metadata } from "next";
import Link from "next/link";

import { VehicleFormWorkflow } from "@/components/admin/vehicle-form-workflow";
import { Button } from "@/components/ui/button";
import { normalizeStep } from "@/lib/admin-vehicle-ui";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Edit vehicle",
  robots: { index: false, follow: false },
};

export default async function EditVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  const user = await requireAdminPage("content:manage");
  const actor = { id: user.id, role: user.role };
  const { id } = await params;
  const query = await searchParams;
  const services = getAdminServices();
  const [vehicle, gallery, brands] = await Promise.all([
    services.vehicleService.getAdminById(actor, id),
    services.vehicleImageService.getGallery(actor, { vehicleId: id }),
    services.brandService.list(actor),
  ]);
  const step = normalizeStep(
    Array.isArray(query.step) ? query.step[0] : query.step,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-gold-foreground">
            Catalogue
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Edit {vehicle.year} {vehicle.brandName} {vehicle.model}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Changes remain private until the server confirms publication
            readiness.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/admin/vehicles/${vehicle.id}`}>View vehicle</Link>
        </Button>
      </div>
      <VehicleFormWorkflow
        brands={brands}
        initialVehicle={vehicle}
        initialGallery={gallery}
        initialStep={step}
      />
    </div>
  );
}
