import { formatTzs } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { VehiclePublicState } from "@/lib/vehicle-public-state";

/**
 * Public price display for a catalogue vehicle.
 *
 * Supports sale-only, rental-only, and dual-mode presentation. A price is
 * rendered only when the centralized {@link VehiclePublicState} marks it
 * displayable, so a sold, retired, or otherwise non-actionable price is never
 * shown as an available price. Daily rental pricing and the minimum rental
 * duration are always clearly labelled.
 */
export function PriceDisplay({
  presentation,
  salePrice,
  rentalDailyPrice,
  minRentalDays,
  className,
}: {
  presentation: Pick<VehiclePublicState, "showSalePrice" | "showRentalPrice">;
  salePrice: number | null;
  rentalDailyPrice: number | null;
  minRentalDays: number | null;
  className?: string;
}) {
  const showSale = presentation.showSalePrice && salePrice !== null;
  const showRental = presentation.showRentalPrice && rentalDailyPrice !== null;
  if (!showSale && !showRental) return null;

  return (
    <div className={cn("space-y-1", className)}>
      {showSale ? (
        <p className="flex items-baseline gap-1">
          <span className="sr-only">Sale price</span>
          <span className="text-lg font-semibold text-brand-gold-foreground">
            {formatTzs(salePrice)}
          </span>
        </p>
      ) : null}
      {showRental ? (
        <p className="text-sm">
          <span className="sr-only">Daily rental price</span>
          <span className="font-semibold">{formatTzs(rentalDailyPrice)}</span>
          <span className="text-muted-foreground"> / day</span>
          {minRentalDays !== null && minRentalDays >= 1 ? (
            <span className="ml-2 text-muted-foreground">
              Minimum {minRentalDays} {minRentalDays === 1 ? "day" : "days"}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
