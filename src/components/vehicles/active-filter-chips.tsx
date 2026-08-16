import { XIcon } from "lucide-react";
import Link from "next/link";

import { formatTzs } from "@/lib/money";
import {
  catalogueHref,
  type AppliedFilters,
  type VehicleBrandFacetOption,
  type VehicleSort,
} from "@/lib/vehicle-filters";
import { SORT_LABELS, vehicleValueLabel } from "@/lib/vehicle-filter-labels";

type Chip = {
  readonly keys: readonly (keyof AppliedFilters)[];
  readonly label: string;
};

export function buildActiveFilterChips(input: {
  readonly appliedFilters: AppliedFilters;
  readonly sort: VehicleSort;
  readonly brands: readonly VehicleBrandFacetOption[];
}): readonly Chip[] {
  const { appliedFilters: filters, sort, brands } = input;
  const chips: Chip[] = [];
  if (filters.q) chips.push({ keys: ["q"], label: `Search: “${filters.q}”` });
  if (filters.brand) {
    const brand = brands.find((option) => option.value === filters.brand);
    chips.push({
      keys: ["brand"],
      label: `Brand: ${brand?.label ?? filters.brand}`,
    });
  }
  for (const [key, label] of [
    ["bodyType", "Body type"],
    ["condition", "Condition"],
    ["transmission", "Transmission"],
    ["fuelType", "Fuel type"],
    ["drivetrain", "Drivetrain"],
    ["driverOption", "Driver option"],
  ] as const) {
    const value = filters[key];
    if (value)
      chips.push({
        keys: [key],
        label: `${label}: ${vehicleValueLabel(value)}`,
      });
  }
  if (filters.yearMin !== undefined || filters.yearMax !== undefined) {
    const value =
      filters.yearMin !== undefined && filters.yearMax !== undefined
        ? `${filters.yearMin}–${filters.yearMax}`
        : filters.yearMin !== undefined
          ? `${filters.yearMin} or newer`
          : `Up to ${filters.yearMax}`;
    chips.push({ keys: ["yearMin", "yearMax"], label: `Year: ${value}` });
  }
  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    const value =
      filters.priceMin !== undefined && filters.priceMax !== undefined
        ? `${formatTzs(filters.priceMin)}–${formatTzs(filters.priceMax)}`
        : filters.priceMin !== undefined
          ? `${formatTzs(filters.priceMin)} or more`
          : `Up to ${formatTzs(filters.priceMax as number)}`;
    chips.push({ keys: ["priceMin", "priceMax"], label: `Price: ${value}` });
  }
  if (sort !== "newest")
    chips.push({ keys: [], label: `Sort: ${SORT_LABELS[sort]}` });
  return chips;
}

export function ActiveFilterChips({
  pathname,
  appliedFilters,
  sort,
  brands,
}: {
  pathname: string;
  appliedFilters: AppliedFilters;
  sort: VehicleSort;
  brands: readonly VehicleBrandFacetOption[];
}) {
  const chips = buildActiveFilterChips({ appliedFilters, sort, brands });
  if (chips.length === 0) return null;
  return (
    <section
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2"
    >
      <h2 className="sr-only">Active filters</h2>
      {chips.map((chip) => {
        const next = { ...appliedFilters };
        for (const key of chip.keys) delete next[key];
        const nextSort = chip.keys.length === 0 ? "newest" : sort;
        return (
          <Link
            key={chip.label}
            href={catalogueHref(pathname, {
              appliedFilters: next,
              sort: nextSort,
              page: 1,
            })}
            aria-label={`Remove ${chip.label}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {chip.label}
            <XIcon aria-hidden="true" className="size-4" />
          </Link>
        );
      })}
      <Link
        href={pathname}
        className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Clear all
      </Link>
    </section>
  );
}
