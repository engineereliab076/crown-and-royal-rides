import { Container } from "@/components/layout/container";
import { CataloguePagination } from "@/components/vehicles/catalogue-pagination";
import { VehicleGrid } from "@/components/vehicles/vehicle-grid";
import type { PublicVehiclePage } from "@/server/modules/vehicles/public-dto";

export function CataloguePage({
  title,
  introduction,
  basePath,
  catalogue,
  emptyTitle,
}: {
  title: string;
  introduction: string;
  basePath: string;
  catalogue: PublicVehiclePage;
  emptyTitle: string;
}) {
  const first =
    catalogue.totalItems === 0
      ? 0
      : (catalogue.page - 1) * catalogue.pageSize + 1;
  const last = Math.min(
    catalogue.page * catalogue.pageSize,
    catalogue.totalItems,
  );
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
        <p
          className="mt-10 mb-5 text-sm text-muted-foreground"
          aria-live="polite"
        >
          {catalogue.totalItems === 0
            ? "No vehicles to display"
            : `Showing ${first}–${last} of ${catalogue.totalItems} vehicles`}
        </p>
        <VehicleGrid
          vehicles={catalogue.items}
          emptyTitle={emptyTitle}
          emptyDescription="Please check back soon or contact our team for assistance."
          aria-label={title}
        />
        <CataloguePagination
          basePath={basePath}
          page={catalogue.page}
          totalPages={catalogue.totalPages}
          hasPreviousPage={catalogue.hasPreviousPage}
          hasNextPage={catalogue.hasNextPage}
          className="mt-10"
        />
      </Container>
    </main>
  );
}
