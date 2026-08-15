import { CatalogueEmptyState } from "@/components/vehicles/catalogue-empty-state";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { cn } from "@/lib/utils";
import type { PublicVehicleCard } from "@/server/modules/vehicles/public-dto";

/**
 * Responsive catalogue grid.
 *
 * Purely presentational: it accepts already-mapped card DTOs and imports no
 * repository or service. When the list is empty it renders the shared
 * accessible empty state instead of an empty grid.
 */
export function VehicleGrid({
  vehicles,
  emptyTitle,
  emptyDescription,
  className,
  "aria-label": ariaLabel,
}: {
  vehicles: readonly PublicVehicleCard[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  "aria-label"?: string;
}) {
  if (vehicles.length === 0) {
    return (
      <CatalogueEmptyState
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }
  return (
    <ul
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {vehicles.map((vehicle) => (
        <li key={vehicle.id}>
          <VehicleCard vehicle={vehicle} />
        </li>
      ))}
    </ul>
  );
}
