"use client";

import {
  ArchiveIcon,
  CheckCircle2Icon,
  EditIcon,
  RotateCcwIcon,
  StarIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import {
  VehicleGalleryManager,
  type GalleryState,
} from "@/components/admin/vehicle-gallery-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTzs } from "@/lib/money";
import { RENTAL_STATUSES, SALE_STATUSES } from "@/lib/vehicle-values";
import type { VehicleAdminDTO } from "@/server/modules/vehicles/dto";

function pretty(value: string): string {
  return value
    .replaceAll(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}
function date(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-TZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date(value));
}
async function responseVehicle(
  response: Response,
  fallback: string,
): Promise<VehicleAdminDTO> {
  const body = (await response.json().catch(() => ({}))) as {
    vehicle?: VehicleAdminDTO;
    error?: { message?: unknown };
  };
  if (response.ok && body.vehicle) return body.vehicle;
  throw new Error(
    typeof body.error?.message === "string" ? body.error.message : fallback,
  );
}

const DANGEROUS = new Set([
  "unpublish",
  "archive",
  "sale_sold",
  "rental_rented",
]);

export function VehicleDetailClient({
  initialVehicle,
  initialGallery,
  featuredCount,
}: {
  initialVehicle: VehicleAdminDTO;
  initialGallery: GalleryState;
  featuredCount: number;
}) {
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { vehicle: VehicleAdminDTO };
    setVehicle(body.vehicle);
  }, [vehicle.id]);

  async function mutate(action: string, confirmed = false) {
    if (pending !== null) return;
    if (DANGEROUS.has(action) && !confirmed) {
      setConfirming(action);
      return;
    }
    setConfirming(null);
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/vehicles/${vehicle.id}/transition`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const updated = await responseVehicle(
        response,
        "The vehicle status could not be changed.",
      );
      setVehicle(updated);
      setNotice(`Vehicle status updated: ${pretty(updated.badge)}.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The vehicle status could not be changed.",
      );
    } finally {
      setPending(null);
    }
  }

  async function feature(featured: boolean) {
    if (pending !== null) return;
    setPending("featured");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/vehicles/${vehicle.id}/featured`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featured }),
        },
      );
      const updated = await responseVehicle(
        response,
        "Featured state could not be changed.",
      );
      setVehicle(updated);
      setNotice(
        featured
          ? "Vehicle featured."
          : "Vehicle removed from featured vehicles.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Featured state could not be changed.",
      );
    } finally {
      setPending(null);
    }
  }

  async function verify() {
    if (pending !== null) return;
    setPending("verify");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicle.id}/verify`, {
        method: "POST",
        credentials: "same-origin",
      });
      const updated = await responseVehicle(
        response,
        "Verification could not be recorded.",
      );
      setVehicle(updated);
      setNotice(
        "Availability verified. No listing, sale, rental, or featured status changed.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Verification could not be recorded.",
      );
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  const publicAvailable =
    vehicle.listingState === "published" &&
    ((vehicle.isForSale && vehicle.saleStatus === "available") ||
      (vehicle.isForRent && vehicle.rentalStatus === "available"));
  const displayedFeaturedCount = Math.max(
    0,
    featuredCount +
      (vehicle.isFeatured === initialVehicle.isFeatured
        ? 0
        : vehicle.isFeatured
          ? 1
          : -1),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-brand-gold-foreground">
              Vehicle
            </p>
            <Badge className="capitalize">{pretty(vehicle.badge)}</Badge>
            <Badge variant="outline" className="capitalize">
              {pretty(vehicle.listingState)}
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {vehicle.year} {vehicle.brandName} {vehicle.model}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Updated {date(vehicle.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/vehicles">Back to vehicles</Link>
          </Button>
          <Button asChild>
            <Link href={`/admin/vehicles/${vehicle.id}/edit`}>
              <EditIcon aria-hidden="true" /> Edit
            </Link>
          </Button>
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border bg-muted/30 p-4 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
            <VehicleGalleryManager
              vehicleId={vehicle.id}
              vehicle={{
                brandName: vehicle.brandName,
                model: vehicle.model,
                year: vehicle.year,
              }}
              initialGallery={initialGallery}
              onGalleryChanged={refresh}
            />
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
            <h2 className="text-lg font-semibold">Vehicle details</h2>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field title="Body type" value={pretty(vehicle.bodyType)} />
              <Field title="Condition" value={pretty(vehicle.condition)} />
              <Field
                title="Transmission"
                value={pretty(vehicle.transmission)}
              />
              <Field title="Fuel type" value={pretty(vehicle.fuelType)} />
              <Field
                title="Drivetrain"
                value={vehicle.drivetrain ? pretty(vehicle.drivetrain) : "—"}
              />
              <Field title="Location" value={vehicle.location ?? "—"} />
              <Field
                title="Mileage"
                value={
                  vehicle.mileageKm == null
                    ? "—"
                    : `${vehicle.mileageKm.toLocaleString("en-TZ")} km`
                }
              />
              <Field
                title="Engine"
                value={
                  [
                    vehicle.engineCc ? `${vehicle.engineCc} cc` : "",
                    vehicle.engineDescription ?? "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
              />
              <Field
                title="Seats / doors"
                value={`${vehicle.seats ?? "—"} / ${vehicle.doors ?? "—"}`}
              />
              <Field
                title="Exterior / interior"
                value={`${vehicle.exteriorColor ?? "—"} / ${vehicle.interiorColor ?? "—"}`}
              />
              <Field
                title="Driver arrangement"
                value={pretty(vehicle.driverOption)}
              />
              <Field title="Driver note" value={vehicle.driverNote ?? "—"} />
            </dl>
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Description</h3>
              <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
                {vehicle.description ?? "No description supplied."}
              </p>
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Features</h3>
              {vehicle.features.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {vehicle.features.map((feature) => (
                    <li
                      key={feature}
                      className="rounded-full border bg-muted/30 px-3 py-1 text-sm"
                    >
                      {feature}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No features supplied.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
            <h2 className="font-semibold text-amber-900">
              Private identifiers · administrators only
            </h2>
            <p className="mt-1 text-sm text-amber-800">
              These values are never exposed through public vehicle responses.
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                title="Registration number"
                value={vehicle.registrationNumber ?? "—"}
              />
              <Field
                title="Chassis number"
                value={vehicle.chassisNumber ?? "—"}
              />
            </dl>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Commercial state</h2>
            <dl className="mt-4 space-y-3">
              <Field
                title="Sale"
                value={
                  vehicle.isForSale
                    ? `${pretty(vehicle.saleStatus ?? "unavailable")} · ${vehicle.salePrice == null ? "—" : formatTzs(vehicle.salePrice)}`
                    : "Disabled"
                }
              />
              <Field
                title="Rental"
                value={
                  vehicle.isForRent
                    ? `${pretty(vehicle.rentalStatus ?? "unavailable")} · ${vehicle.rentalDailyPrice == null ? "—" : `${formatTzs(vehicle.rentalDailyPrice)}/day`}`
                    : "Disabled"
                }
              />
              <Field
                title="Featured"
                value={
                  vehicle.isFeatured
                    ? `Yes · ${date(vehicle.featuredAt)}`
                    : "No"
                }
              />
              <Field
                title="Last verified"
                value={date(vehicle.lastVerifiedAt)}
              />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {vehicle.isForSale
                ? SALE_STATUSES.map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={
                        vehicle.saleStatus === status ? "secondary" : "outline"
                      }
                      disabled={busy || vehicle.saleStatus === status}
                      onClick={() => void mutate(`sale_${status}`)}
                    >
                      {pretty(status)}
                    </Button>
                  ))
                : null}
              {vehicle.isForRent
                ? RENTAL_STATUSES.map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={
                        vehicle.rentalStatus === status
                          ? "secondary"
                          : "outline"
                      }
                      disabled={busy || vehicle.rentalStatus === status}
                      onClick={() => void mutate(`rental_${status}`)}
                    >
                      Rental {pretty(status)}
                    </Button>
                  ))
                : null}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Publication readiness</h2>
            {vehicle.publicationReadiness.ready ? (
              <p className="mt-2 text-sm text-emerald-700">
                All server requirements are satisfied.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {vehicle.publicationReadiness.missing.length} requirement
                  {vehicle.publicationReadiness.missing.length === 1
                    ? ""
                    : "s"}{" "}
                  missing.
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {vehicle.publicationReadiness.checklist
                    .filter((item) => !item.met)
                    .map((item) => (
                      <li key={item.key}>{item.label}</li>
                    ))}
                </ul>
              </>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {vehicle.listingState === "draft" ? (
                <Button
                  type="button"
                  disabled={busy || !vehicle.publicationReadiness.ready}
                  onClick={() => void mutate("publish")}
                >
                  <CheckCircle2Icon aria-hidden="true" /> Publish
                </Button>
              ) : null}
              {vehicle.listingState === "published" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void mutate("unpublish")}
                >
                  Unpublish
                </Button>
              ) : null}
              {vehicle.listingState !== "archived" ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void mutate("archive")}
                >
                  <ArchiveIcon aria-hidden="true" /> Archive
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate("restore")}
                >
                  <RotateCcwIcon aria-hidden="true" /> Restore to draft
                </Button>
              )}
            </div>
            {publicAvailable ? (
              <Button asChild variant="link" className="mt-2 px-0">
                <Link href={`/cars/${vehicle.slug}`}>Open public detail</Link>
              </Button>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Featured and verification</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {displayedFeaturedCount} of 8 vehicles featured.
            </p>
            {displayedFeaturedCount >= 8 && !vehicle.isFeatured ? (
              <p className="mt-2 text-xs text-amber-700">
                The featured limit is full. Unfeature another vehicle first; the
                server remains authoritative.
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2">
              {vehicle.isFeatured ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void feature(false)}
                >
                  <StarIcon aria-hidden="true" /> Unfeature
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy ||
                    vehicle.listingState !== "published" ||
                    !vehicle.publicationReadiness.ready
                  }
                  onClick={() => void feature(true)}
                >
                  <StarIcon aria-hidden="true" /> Feature vehicle
                </Button>
              )}
              <Button
                type="button"
                disabled={busy}
                onClick={() => void verify()}
              >
                <CheckCircle2Icon aria-hidden="true" /> Still available
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Timeline</h2>
            <dl className="mt-4 space-y-3">
              <Field title="Created" value={date(vehicle.createdAt)} />
              <Field title="Updated" value={date(vehicle.updatedAt)} />
              <Field title="Published" value={date(vehicle.publishedAt)} />
            </dl>
          </section>
        </aside>
      </div>

      {confirming ? (
        <div
          role="group"
          aria-label={`Confirm ${pretty(confirming)} action`}
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border bg-background p-4 shadow-xl"
        >
          <p className="font-medium">Confirm {pretty(confirming)}?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This changes vehicle availability and may remove it from public
            views.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void mutate(confirming, true)}
            >
              Confirm {pretty(confirming)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{title}</dt>
      <dd className="mt-1 text-sm whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
