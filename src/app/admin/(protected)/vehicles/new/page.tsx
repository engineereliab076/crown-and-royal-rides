import type { Metadata } from "next";
import Link from "next/link";

import { VehicleFormWorkflow } from "@/components/admin/vehicle-form-workflow";
import { Button } from "@/components/ui/button";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Add vehicle",
  robots: { index: false, follow: false },
};

export default async function NewVehiclePage() {
  const user = await requireAdminPage("content:manage");
  const brands = await getAdminServices().brandService.list({
    id: user.id,
    role: user.role,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-gold-foreground">
            Catalogue
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Add vehicle
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a private draft, then complete the seven-step publication
            workflow.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/vehicles">Back to vehicles</Link>
        </Button>
      </div>
      {brands.length === 0 ? (
        <div
          role="status"
          className="rounded-2xl border bg-card p-8 text-center"
        >
          <h2 className="font-semibold">Add a brand first</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every vehicle needs a managed brand before its draft can be created.
          </p>
          <Button asChild className="mt-5">
            <Link href="/admin/brands">Manage brands</Link>
          </Button>
        </div>
      ) : (
        <VehicleFormWorkflow
          brands={brands}
          initialVehicle={null}
          initialGallery={null}
          initialStep={1}
        />
      )}
    </div>
  );
}
