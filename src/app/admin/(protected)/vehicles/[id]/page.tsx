import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { VehiclePublishButton } from "@/components/admin/vehicle-publish-button";
import { VehicleCoverUploader } from "@/components/admin/vehicle-cover-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTzs } from "@/lib/money";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Vehicle detail",
  robots: { index: false, follow: false },
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  coverImage: "Cover image",
  saleMode: "Sale mode and status",
  salePrice: "Positive sale price",
  description: "Description of at least 40 characters",
};

function pretty(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdminPage("content:manage");
  const { id } = await params;
  const vehicle = await getAdminServices().vehicleService.getAdminById(
    { id: user.id, role: user.role },
    id,
  );
  const fields = [
    ["Year", String(vehicle.year)],
    ["Body type", pretty(vehicle.bodyType)],
    ["Condition", pretty(vehicle.condition)],
    ["Transmission", pretty(vehicle.transmission)],
    ["Fuel type", pretty(vehicle.fuelType)],
    ["Driver option", pretty(vehicle.driverOption)],
    ["Sale status", vehicle.saleStatus ? pretty(vehicle.saleStatus) : "—"],
    [
      "Sale price",
      vehicle.salePrice === null ? "—" : formatTzs(vehicle.salePrice),
    ],
  ] as const;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-brand-gold-foreground">
              Vehicle
            </p>
            <Badge
              variant={
                vehicle.listingState === "published" ? "default" : "secondary"
              }
              className="capitalize"
            >
              {vehicle.listingState}
            </Badge>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {vehicle.brandName} {vehicle.model}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Slug: {vehicle.slug}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/vehicles">Back to vehicles</Link>
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-6 rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
          {vehicle.coverImage ? (
            <figure className="overflow-hidden rounded-xl border bg-muted">
              {/* The URL was independently verified by the server-side media adapter. */}
              <Image
                src={vehicle.coverImage.url}
                alt={
                  vehicle.coverImage.altText ??
                  `${vehicle.brandName} ${vehicle.model}`
                }
                width={vehicle.coverImage.width}
                height={vehicle.coverImage.height}
                sizes="(min-width: 1024px) calc(100vw - 28rem), (min-width: 640px) calc(100vw - 3rem), calc(100vw - 2rem)"
                unoptimized
                className="aspect-video w-full object-cover"
              />
            </figure>
          ) : (
            <VehicleCoverUploader vehicleId={vehicle.id} />
          )}
          <dl className="grid gap-5 sm:grid-cols-2">
            {fields.map(([title, value]) => (
              <div key={title}>
                <dt className="text-xs font-medium text-muted-foreground">
                  {title}
                </dt>
                <dd className="mt-1 text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h2 className="text-sm font-semibold">Description</h2>
            <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
              {vehicle.description || "No description supplied."}
            </p>
          </div>
        </section>
        <aside className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
          <div>
            <h2 className="font-semibold">Publication readiness</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              All requirements must be met before this draft can go live.
            </p>
          </div>
          {vehicle.publicationReadiness.ready ? (
            <p className="text-sm text-emerald-700">Ready to publish.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {vehicle.publicationReadiness.missing.map((item) => (
                <li key={item}>{FIELD_LABELS[item] ?? item}</li>
              ))}
            </ul>
          )}
          <VehiclePublishButton
            vehicleId={vehicle.id}
            published={vehicle.listingState === "published"}
          />
        </aside>
      </div>
    </div>
  );
}
