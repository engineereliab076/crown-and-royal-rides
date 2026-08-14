"use client";

import { CheckCircle2Icon, EditIcon, EyeIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloudinaryLoader } from "@/lib/cloudinary-loader";
import {
  serializeVehicleFilters,
  type VehicleFilterState,
} from "@/lib/admin-vehicle-ui";
import { formatTzs } from "@/lib/money";
import {
  LISTING_STATES,
  RENTAL_STATUSES,
  SALE_STATUSES,
} from "@/lib/vehicle-values";
import type { VehicleAdminDTO } from "@/server/modules/vehicles/dto";

interface BrandOption {
  readonly id: string;
  readonly name: string;
}

function pretty(value: string): string {
  return value
    .replaceAll(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function date(value: string | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat("en-TZ", {
    dateStyle: "medium",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date(value));
}

function publicAvailable(vehicle: VehicleAdminDTO): boolean {
  return (
    vehicle.listingState === "published" &&
    ((vehicle.isForSale && vehicle.saleStatus === "available") ||
      (vehicle.isForRent && vehicle.rentalStatus === "available"))
  );
}

export function VehicleListClient({
  initialItems,
  filters,
  brands,
  total,
  page,
  limit,
  initialFeaturedCount,
}: {
  initialItems: readonly VehicleAdminDTO[];
  filters: VehicleFilterState;
  brands: readonly BrandOption[];
  total: number;
  page: number;
  limit: number;
  initialFeaturedCount: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "verify" | "feature" | null
  >(null);
  const [featuredCount, setFeaturedCount] = useState(initialFeaturedCount);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  async function verify(vehicleId: string) {
    if (pendingId !== null) return;
    setPendingId(vehicleId);
    setPendingAction("verify");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/verify`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as {
        vehicle?: VehicleAdminDTO;
        error?: { message?: unknown };
      };
      if (!response.ok || !body.vehicle)
        throw new Error(
          typeof body.error?.message === "string"
            ? body.error.message
            : "Verification could not be recorded.",
        );
      setItems((current) =>
        current.map((item) => (item.id === vehicleId ? body.vehicle! : item)),
      );
      setNotice(
        "Availability verified without changing listing or commercial status.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Verification could not be recorded.",
      );
    } finally {
      setPendingId(null);
      setPendingAction(null);
    }
  }

  async function feature(vehicleId: string, featured: boolean) {
    if (pendingId !== null) return;
    setPendingId(vehicleId);
    setPendingAction("feature");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/vehicles/${vehicleId}/featured`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featured }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        vehicle?: VehicleAdminDTO;
        error?: { message?: unknown };
      };
      if (!response.ok || !body.vehicle) {
        throw new Error(
          typeof body.error?.message === "string"
            ? body.error.message
            : "Featured state could not be changed.",
        );
      }
      setItems((current) =>
        current.map((item) => (item.id === vehicleId ? body.vehicle! : item)),
      );
      setFeaturedCount((current) => Math.max(0, current + (featured ? 1 : -1)));
      setNotice(featured ? "Vehicle featured." : "Vehicle unfeatured.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Featured state could not be changed.",
      );
    } finally {
      setPendingId(null);
      setPendingAction(null);
    }
  }

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
            Manage lifecycle, availability, pricing, publication readiness, and
            verification.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {featuredCount} of 8 vehicles featured.
            {featuredCount >= 8 ? " The featured limit is currently full." : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/brands">Manage brands</Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/admin/vehicles/new">
              <PlusIcon aria-hidden="true" /> Add vehicle
            </Link>
          </Button>
        </div>
      </div>

      <form
        action="/admin/vehicles"
        method="get"
        className="rounded-2xl border bg-card p-4 shadow-soft"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              name="search"
              defaultValue={filters.search}
              placeholder="Brand, model, or slug"
              maxLength={120}
            />
          </div>
          <Filter
            id="listingState"
            label="Listing state"
            value={filters.listingState}
            options={LISTING_STATES}
          />
          <Filter
            id="saleStatus"
            label="Sale status"
            value={filters.saleStatus}
            options={SALE_STATUSES}
          />
          <Filter
            id="rentalStatus"
            label="Rental status"
            value={filters.rentalStatus}
            options={RENTAL_STATUSES}
          />
          <Filter
            id="brandId"
            label="Brand"
            value={filters.brandId}
            options={brands.map((brand) => ({
              value: brand.id,
              label: brand.name,
            }))}
          />
          <Filter
            id="isForSale"
            label="Sale mode"
            value={filters.isForSale}
            options={[
              { value: "true", label: "Enabled" },
              { value: "false", label: "Disabled" },
            ]}
          />
          <Filter
            id="isForRent"
            label="Rental mode"
            value={filters.isForRent}
            options={[
              { value: "true", label: "Enabled" },
              { value: "false", label: "Disabled" },
            ]}
          />
          <Filter
            id="featured"
            label="Featured"
            value={filters.featured}
            options={[
              { value: "true", label: "Featured" },
              { value: "false", label: "Not featured" },
            ]}
          />
          <Filter
            id="verified"
            label="Verification"
            value={filters.verified}
            options={[
              { value: "true", label: "Verified" },
              { value: "false", label: "Never verified" },
            ]}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit">Apply filters</Button>
          <Button asChild type="button" variant="outline">
            <Link href="/admin/vehicles">Reset</Link>
          </Button>
        </div>
      </form>

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

      {items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <h2 className="font-semibold">No matching vehicles</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Adjust the filters or create a new draft.
          </p>
          <Button asChild className="mt-5">
            <Link href="/admin/vehicles/new">Add vehicle</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-soft md:block">
            <table className="w-full min-w-[72rem] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Sale / rental</th>
                  <th className="px-4 py-3 font-medium">Readiness</th>
                  <th className="px-4 py-3 font-medium">Verification</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-muted/20">
                    <td className="px-4 py-4">
                      <VehicleIdentity vehicle={vehicle} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        <Badge>{pretty(vehicle.badge)}</Badge>
                        {vehicle.isFeatured ? (
                          <Badge variant="outline">Featured</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs">
                      <Commercial vehicle={vehicle} />
                    </td>
                    <td className="px-4 py-4">
                      <Readiness vehicle={vehicle} />
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs">{date(vehicle.lastVerifiedAt)}</p>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        disabled={pendingId !== null}
                        onClick={() => void verify(vehicle.id)}
                      >
                        {pendingId === vehicle.id && pendingAction === "verify"
                          ? "Verifying…"
                          : "Still available"}
                      </Button>
                    </td>
                    <td className="px-4 py-4 text-xs">
                      {date(vehicle.updatedAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <Actions vehicle={vehicle} />
                        <FeaturedControl
                          vehicle={vehicle}
                          featuredCount={featuredCount}
                          pending={pendingId !== null}
                          active={
                            pendingId === vehicle.id &&
                            pendingAction === "feature"
                          }
                          onChange={feature}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-4 md:hidden">
            {items.map((vehicle) => (
              <li
                key={vehicle.id}
                className="rounded-2xl border bg-card p-4 shadow-soft"
              >
                <VehicleIdentity vehicle={vehicle} />
                <div className="mt-4 flex flex-wrap gap-1">
                  <Badge>{pretty(vehicle.badge)}</Badge>
                  {vehicle.isFeatured ? (
                    <Badge variant="outline">Featured</Badge>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Sale / rental
                    </dt>
                    <dd className="mt-1">
                      <Commercial vehicle={vehicle} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Readiness</dt>
                    <dd className="mt-1">
                      <Readiness vehicle={vehicle} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Verified</dt>
                    <dd>{date(vehicle.lastVerifiedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Updated</dt>
                    <dd>{date(vehicle.updatedAt)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Actions vehicle={vehicle} />
                  <FeaturedControl
                    vehicle={vehicle}
                    featuredCount={featuredCount}
                    pending={pendingId !== null}
                    active={
                      pendingId === vehicle.id && pendingAction === "feature"
                    }
                    onChange={feature}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingId !== null}
                    onClick={() => void verify(vehicle.id)}
                  >
                    <CheckCircle2Icon aria-hidden="true" />
                    {pendingId === vehicle.id && pendingAction === "verify"
                      ? "Verifying…"
                      : "Still available"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <nav
        aria-label="Vehicle pagination"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "0 vehicles"
            : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
        </p>
        <div className="flex gap-2">
          {page <= 1 ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={serializeVehicleFilters(filters, { page: page - 1 })}>
                Previous
              </Link>
            </Button>
          )}
          <span className="flex min-h-9 items-center px-2 text-sm">
            Page {page} of {totalPages}
          </span>
          {page >= totalPages ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={serializeVehicleFilters(filters, { page: page + 1 })}>
                Next
              </Link>
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}

function Filter({
  id,
  label,
  value,
  options,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly (string | { value: string; label: string })[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        defaultValue={value}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">All</option>
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: pretty(option) }
              : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function VehicleIdentity({ vehicle }: { vehicle: VehicleAdminDTO }) {
  return (
    <div className="flex min-w-56 items-center gap-3">
      {vehicle.coverImage ? (
        <Image
          loader={cloudinaryLoader}
          src={vehicle.coverImage.url}
          alt={vehicle.coverImage.altText ?? ""}
          width={vehicle.coverImage.width}
          height={vehicle.coverImage.height}
          sizes="64px"
          className="h-12 w-16 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-12 w-16 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
          No image
        </div>
      )}
      <div>
        <p className="font-medium">
          {vehicle.year} {vehicle.brandName} {vehicle.model}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {vehicle.location ?? "No location"}
        </p>
      </div>
    </div>
  );
}

function Commercial({ vehicle }: { vehicle: VehicleAdminDTO }) {
  return (
    <div className="space-y-1">
      {vehicle.isForSale ? (
        <p>
          Sale: {pretty(vehicle.saleStatus ?? "unset")}
          {vehicle.salePrice == null
            ? ""
            : ` · ${formatTzs(vehicle.salePrice)}`}
        </p>
      ) : null}
      {vehicle.isForRent ? (
        <p>
          Rent: {pretty(vehicle.rentalStatus ?? "unset")}
          {vehicle.rentalDailyPrice == null
            ? ""
            : ` · ${formatTzs(vehicle.rentalDailyPrice)}/day`}
        </p>
      ) : null}
      {!vehicle.isForSale && !vehicle.isForRent ? (
        <p className="text-muted-foreground">No mode</p>
      ) : null}
    </div>
  );
}

function Readiness({ vehicle }: { vehicle: VehicleAdminDTO }) {
  return vehicle.publicationReadiness.ready ? (
    <span className="text-xs font-medium text-emerald-700">Ready</span>
  ) : (
    <span className="text-xs text-amber-700">
      {vehicle.publicationReadiness.missing.length} missing
    </span>
  );
}

function Actions({ vehicle }: { vehicle: VehicleAdminDTO }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/vehicles/${vehicle.id}`}>
          <EyeIcon aria-hidden="true" /> View
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/vehicles/${vehicle.id}/edit`}>
          <EditIcon aria-hidden="true" /> Edit
        </Link>
      </Button>
      {publicAvailable(vehicle) ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/cars/${vehicle.slug}`}>Public</Link>
        </Button>
      ) : null}
    </div>
  );
}

function FeaturedControl({
  vehicle,
  featuredCount,
  pending,
  active,
  onChange,
}: {
  vehicle: VehicleAdminDTO;
  featuredCount: number;
  pending: boolean;
  active: boolean;
  onChange(vehicleId: string, featured: boolean): Promise<void>;
}) {
  const eligible =
    vehicle.listingState === "published" && vehicle.publicationReadiness.ready;
  const disabled =
    pending || (!vehicle.isFeatured && (!eligible || featuredCount >= 8));
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      title={
        !vehicle.isFeatured && featuredCount >= 8
          ? "Unfeature another vehicle first."
          : undefined
      }
      onClick={() => void onChange(vehicle.id, !vehicle.isFeatured)}
    >
      {active ? "Updating…" : vehicle.isFeatured ? "Unfeature" : "Feature"}
    </Button>
  );
}
