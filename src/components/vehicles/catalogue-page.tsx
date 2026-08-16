import { Container } from "@/components/layout/container";
import {
  ActiveFilterChips,
  buildActiveFilterChips,
} from "@/components/vehicles/active-filter-chips";
import { CatalogueFilters } from "@/components/vehicles/catalogue-filters";
import { CataloguePagination } from "@/components/vehicles/catalogue-pagination";
import { VehicleGrid } from "@/components/vehicles/vehicle-grid";
import type { VehicleMode } from "@/lib/vehicle-filters";
import type { VehicleCatalogueSearchResult } from "@/server/modules/vehicles/public-dto";
import Link from "next/link";

export function CataloguePage({
  title,
  introduction,
  basePath,
  catalogue,
  emptyTitle,
  mode,
}: {
  title: string;
  introduction: string;
  basePath: string;
  catalogue: VehicleCatalogueSearchResult;
  emptyTitle: string;
  mode: VehicleMode;
}) {
  const first =
    catalogue.totalItems === 0
      ? 0
      : (catalogue.page - 1) * catalogue.pageSize + 1;
  const last = Math.min(
    catalogue.page * catalogue.pageSize,
    catalogue.totalItems,
  );
  const activeFilterCount = buildActiveFilterChips({
    appliedFilters: catalogue.appliedFilters,
    sort: catalogue.sort,
    brands: catalogue.facets.brand,
  }).length;
  return (
    <main id="main-content" className="flex-1 py-12 sm:py-16">
      <Container>
        <header className="max-w-3xl">
          <p className="text-eyebrow font-semibold tracking-widest text-brand-gold-foreground uppercase">
            Our collection
          </p>
          <h1 className="mt-3 text-title font-semibold text-balance">
            {title}
          </h1>
          <p className="mt-4 text-body-lg text-muted-foreground">
            {introduction}
          </p>
        </header>
        {catalogue.meta.ignoredFilters.length > 0 ? (
          <p
            role="status"
            className="mt-8 rounded-lg border bg-surface-subtle px-4 py-3 text-sm"
          >
            Some unsupported filter values were ignored.
          </p>
        ) : null}
        <div className="mt-8 flex items-center justify-between gap-4 lg:hidden">
          <CatalogueFilters
            pathname={basePath}
            mode={mode}
            appliedFilters={catalogue.appliedFilters}
            sort={catalogue.sort}
            facets={catalogue.facets}
            totalItems={catalogue.totalItems}
            activeFilterCount={activeFilterCount}
          />
        </div>
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="hidden lg:block">
            <CatalogueFilters
              pathname={basePath}
              mode={mode}
              appliedFilters={catalogue.appliedFilters}
              sort={catalogue.sort}
              facets={catalogue.facets}
              totalItems={catalogue.totalItems}
              activeFilterCount={activeFilterCount}
            />
          </div>
          <div className="min-w-0">
            <ActiveFilterChips
              pathname={basePath}
              appliedFilters={catalogue.appliedFilters}
              sort={catalogue.sort}
              brands={catalogue.facets.brand}
            />
            <p
              className="mt-5 mb-5 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {catalogue.totalItems === 0
                ? "No vehicles match these filters"
                : `Showing ${first}–${last} of ${catalogue.totalItems} ${catalogue.totalItems === 1 ? "vehicle" : "vehicles"}`}
            </p>
            {catalogue.items.length === 0 && activeFilterCount > 0 ? (
              <div
                role="status"
                className="rounded-2xl border border-dashed bg-surface-subtle px-6 py-16 text-center"
              >
                <p className="font-semibold">No vehicles match your filters</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try removing a filter or start again.
                </p>
                <Link
                  href={basePath}
                  className="mt-5 inline-flex min-h-11 items-center rounded-lg border bg-background px-5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear all filters
                </Link>
              </div>
            ) : (
              <VehicleGrid
                vehicles={catalogue.items}
                emptyTitle={emptyTitle}
                emptyDescription="Please check back soon or contact our team for assistance."
                aria-label={title}
              />
            )}
            <CataloguePagination
              basePath={basePath}
              page={catalogue.page}
              totalPages={catalogue.totalPages}
              hasPreviousPage={catalogue.hasPreviousPage}
              hasNextPage={catalogue.hasNextPage}
              appliedFilters={catalogue.appliedFilters}
              sort={catalogue.sort}
              className="mt-10"
            />
          </div>
        </div>
      </Container>
    </main>
  );
}
