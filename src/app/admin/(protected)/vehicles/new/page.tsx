import type { Metadata } from "next";
import Link from "next/link";

import { VehicleCreateForm } from "@/components/admin/vehicle-create-form";
import { Button } from "@/components/ui/button";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Add vehicle",
  robots: { index: false, follow: false },
};

export default async function NewVehiclePage() {
  const user = await requireAdminPage("content:manage");
  const brands = await getAdminServices().vehicleService.listBrands({
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
            Create a sale-only draft. Images are added in the next
            implementation group.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/vehicles">Back to vehicles</Link>
        </Button>
      </div>
      {brands.length === 0 ? (
        <div
          role="status"
          className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground"
        >
          No brands are available. Add foundation brand data before creating a
          vehicle.
        </div>
      ) : (
        <VehicleCreateForm brands={brands} />
      )}
    </div>
  );
}
