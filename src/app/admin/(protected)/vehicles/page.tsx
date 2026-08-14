import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTzs } from "@/lib/money";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Vehicles",
  robots: { index: false, follow: false },
};

export default async function AdminVehiclesPage() {
  const user = await requireAdminPage("content:manage");
  const page = await getAdminServices().vehicleService.listAdmin(
    { id: user.id, role: user.role },
    { page: 1, limit: 100 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-gold-foreground">
            Catalogue
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Vehicles
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage draft and published vehicle listings.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/admin/vehicles/new">Add vehicle</Link>
        </Button>
      </div>
      {page.items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <h2 className="font-semibold">No vehicles yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create the first draft vehicle to start the catalogue.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Vehicle</th>
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Sale price</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-muted/20">
                  <td className="px-4 py-4 font-medium">
                    {vehicle.brandName} {vehicle.model}
                  </td>
                  <td className="px-4 py-4">{vehicle.year}</td>
                  <td className="px-4 py-4">
                    <Badge
                      variant={
                        vehicle.listingState === "published"
                          ? "default"
                          : "secondary"
                      }
                      className="capitalize"
                    >
                      {vehicle.listingState}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    {vehicle.salePrice === null
                      ? "—"
                      : formatTzs(vehicle.salePrice)}
                  </td>
                  <td className="px-4 py-4">
                    {new Intl.DateTimeFormat("en-TZ", {
                      dateStyle: "medium",
                      timeZone: "Africa/Dar_es_Salaam",
                    }).format(new Date(vehicle.createdAt))}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/vehicles/${vehicle.id}`}>View</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
