"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  AppliedFilters,
  VehicleFacets,
  VehicleMode,
  VehicleSort,
} from "@/lib/vehicle-filters";
import { SORT_LABELS, vehicleValueLabel } from "@/lib/vehicle-filter-labels";

const CONTROL_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const PARAMETER_ORDER = [
  "q",
  "brand",
  "bodyType",
  "condition",
  "transmission",
  "fuelType",
  "drivetrain",
  "driverOption",
  "yearMin",
  "yearMax",
  "priceMin",
  "priceMax",
  "sort",
] as const;

type Props = {
  readonly pathname: string;
  readonly mode: VehicleMode;
  readonly appliedFilters: AppliedFilters;
  readonly sort: VehicleSort;
  readonly facets: VehicleFacets;
  readonly totalItems: number;
  readonly activeFilterCount: number;
};

function optionText(label: string, count: number): string {
  return `${label} (${count} ${count === 1 ? "vehicle" : "vehicles"})`;
}

function EnumSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  options: readonly { value: string; count: number }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ""}
        className={CONTROL_CLASS}
      >
        <option value="">Any {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionText(vehicleValueLabel(option.value), option.count)}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterFields({
  idPrefix,
  mode,
  appliedFilters,
  sort,
  facets,
}: Omit<Props, "pathname" | "totalItems" | "activeFilterCount"> & {
  idPrefix: string;
}) {
  const sorts: VehicleSort[] = ["newest", "year_desc"];
  if (mode !== "all") sorts.splice(1, 0, "price_asc", "price_desc");
  if (appliedFilters.q) sorts.push("relevance");

  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor={`${idPrefix}-q`}
          className="mb-1.5 block text-sm font-medium"
        >
          Search
        </label>
        <input
          id={`${idPrefix}-q`}
          name="q"
          type="search"
          maxLength={120}
          defaultValue={appliedFilters.q ?? ""}
          placeholder="Brand or model"
          className={CONTROL_CLASS}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">Vehicle details</legend>
        <div>
          <label
            htmlFor={`${idPrefix}-brand`}
            className="mb-1.5 block text-sm font-medium"
          >
            Brand
          </label>
          <select
            id={`${idPrefix}-brand`}
            name="brand"
            defaultValue={appliedFilters.brand ?? ""}
            className={CONTROL_CLASS}
          >
            <option value="">Any brand</option>
            {facets.brand.map((option) => (
              <option key={option.value} value={option.value}>
                {optionText(option.label, option.count)}
              </option>
            ))}
          </select>
        </div>
        <EnumSelect
          id={`${idPrefix}-bodyType`}
          name="bodyType"
          label="Body type"
          value={appliedFilters.bodyType}
          options={facets.bodyType}
        />
        <EnumSelect
          id={`${idPrefix}-condition`}
          name="condition"
          label="Condition"
          value={appliedFilters.condition}
          options={facets.condition}
        />
        <EnumSelect
          id={`${idPrefix}-transmission`}
          name="transmission"
          label="Transmission"
          value={appliedFilters.transmission}
          options={facets.transmission}
        />
        <EnumSelect
          id={`${idPrefix}-fuelType`}
          name="fuelType"
          label="Fuel type"
          value={appliedFilters.fuelType}
          options={facets.fuelType}
        />
        <EnumSelect
          id={`${idPrefix}-drivetrain`}
          name="drivetrain"
          label="Drivetrain"
          value={appliedFilters.drivetrain}
          options={facets.drivetrain}
        />
        <EnumSelect
          id={`${idPrefix}-driverOption`}
          name="driverOption"
          label="Driver option"
          value={appliedFilters.driverOption}
          options={facets.driverOption}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Model year</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-yearMin`}
              className="mb-1.5 block text-sm font-medium"
            >
              Minimum
            </label>
            <input
              id={`${idPrefix}-yearMin`}
              name="yearMin"
              type="number"
              inputMode="numeric"
              min={1980}
              max={2100}
              defaultValue={appliedFilters.yearMin}
              placeholder={facets.year ? String(facets.year.min) : "1980"}
              className={CONTROL_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-yearMax`}
              className="mb-1.5 block text-sm font-medium"
            >
              Maximum
            </label>
            <input
              id={`${idPrefix}-yearMax`}
              name="yearMax"
              type="number"
              inputMode="numeric"
              min={1980}
              max={2100}
              defaultValue={appliedFilters.yearMax}
              placeholder={facets.year ? String(facets.year.max) : "2100"}
              className={CONTROL_CLASS}
            />
          </div>
        </div>
      </fieldset>

      {mode !== "all" ? (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">
            {mode === "sale" ? "Sale price (TZS)" : "Daily rental price (TZS)"}
          </legend>
          <p className="mb-3 text-xs text-muted-foreground">
            Whole Tanzanian shillings
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${idPrefix}-priceMin`}
                className="mb-1.5 block text-sm font-medium"
              >
                Minimum
              </label>
              <input
                id={`${idPrefix}-priceMin`}
                name="priceMin"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                defaultValue={appliedFilters.priceMin}
                placeholder={
                  facets.price ? String(facets.price.min) : undefined
                }
                className={CONTROL_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor={`${idPrefix}-priceMax`}
                className="mb-1.5 block text-sm font-medium"
              >
                Maximum
              </label>
              <input
                id={`${idPrefix}-priceMax`}
                name="priceMax"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                defaultValue={appliedFilters.priceMax}
                placeholder={
                  facets.price ? String(facets.price.max) : undefined
                }
                className={CONTROL_CLASS}
              />
            </div>
          </div>
        </fieldset>
      ) : null}

      <div>
        <label
          htmlFor={`${idPrefix}-sort`}
          className="mb-1.5 block text-sm font-medium"
        >
          Sort
        </label>
        <select
          id={`${idPrefix}-sort`}
          name="sort"
          defaultValue={sort}
          className={CONTROL_CLASS}
        >
          {sorts.map((value) => (
            <option key={value} value={value}>
              {mode === "rental" && value === "price_asc"
                ? "Daily price: low to high"
                : mode === "rental" && value === "price_desc"
                  ? "Daily price: high to low"
                  : SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function useCatalogueForm(pathname: string) {
  const router = useRouter();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of PARAMETER_ORDER) {
      const value = data.get(key);
      if (typeof value !== "string") continue;
      const normalized = value.trim();
      if (normalized === "" || (key === "sort" && normalized === "newest"))
        continue;
      params.set(key, normalized);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };
}

export function CatalogueFilters(props: Props) {
  const submit = useCatalogueForm(props.pathname);
  const [draftChanged, setDraftChanged] = useState(false);
  const stateKey = JSON.stringify([
    props.appliedFilters,
    props.sort,
    props.totalItems,
  ]);
  const id = useId().replace(/:/g, "");

  useEffect(() => setDraftChanged(false), [stateKey]);

  return (
    <>
      <aside aria-label="Catalogue filters" className="hidden lg:block">
        <form
          method="get"
          action={props.pathname}
          onSubmit={submit}
          className="rounded-2xl border bg-card p-5 shadow-soft"
        >
          <h2 className="text-lg font-semibold">Filter vehicles</h2>
          <div className="mt-5">
            <FilterFields
              idPrefix={`${id}-desktop`}
              mode={props.mode}
              appliedFilters={props.appliedFilters}
              sort={props.sort}
              facets={props.facets}
            />
          </div>
          <div className="mt-6 grid gap-3">
            <Button type="submit" className="min-h-11">
              Apply filters
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={props.pathname}>Clear all</Link>
            </Button>
          </div>
        </form>
      </aside>

      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="min-h-11">
              <SlidersHorizontalIcon aria-hidden="true" />
              Filters
              {props.activeFilterCount > 0
                ? ` (${props.activeFilterCount})`
                : ""}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[90dvh] overflow-hidden rounded-t-2xl"
            aria-describedby={`${id}-sheet-description`}
          >
            <SheetHeader className="border-b pr-14">
              <SheetTitle>Filter vehicles</SheetTitle>
              <SheetDescription id={`${id}-sheet-description`}>
                Choose filters, then apply them to see the exact result count.
              </SheetDescription>
            </SheetHeader>
            <form
              method="get"
              action={props.pathname}
              onSubmit={submit}
              onChange={() => setDraftChanged(true)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
                <FilterFields
                  idPrefix={`${id}-mobile`}
                  mode={props.mode}
                  appliedFilters={props.appliedFilters}
                  sort={props.sort}
                  facets={props.facets}
                />
              </div>
              <SheetFooter className="sticky bottom-0 border-t bg-popover shadow-[0_-4px_16px_rgb(0_0_0/0.06)]">
                <Button type="submit" className="min-h-11">
                  {draftChanged
                    ? "Apply filters"
                    : `Show ${props.totalItems} ${props.totalItems === 1 ? "car" : "cars"}`}
                </Button>
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={props.pathname}>Clear all</Link>
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
