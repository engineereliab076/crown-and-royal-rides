import Image from "next/image";
import Link from "next/link";
import { MapPinIcon } from "lucide-react";

import { PriceDisplay } from "@/components/vehicles/price-display";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { cn } from "@/lib/utils";
import type { PublicVehicleCard } from "@/server/modules/vehicles/public-dto";

/** Responsive sizes for a card cover in the 1/2/3-column catalogue grid. */
const CARD_IMAGE_SIZES =
  "(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 100vw";

function driverLabel(driverOption: string): string {
  return driverOption === "with_driver" ? "With driver" : "Self-drive";
}

/**
 * A single catalogue vehicle card.
 *
 * The whole card is one semantic linked article: a single `next/link` is the
 * only interactive control, so keyboard navigation reaches the entire card and
 * there are no nested interactive elements. The cover renders through the
 * verified Cloudinary loader with meaningful alt text, and status is conveyed
 * by the accessible {@link VehicleStatusBadge} (never by color alone).
 */
export function VehicleCard({
  vehicle,
  className,
}: {
  vehicle: PublicVehicleCard;
  className?: string;
}) {
  const title = `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`;
  const cover = vehicle.coverImage;
  return (
    <article className={cn("group h-full", className)}>
      <Link
        href={`/cars/${vehicle.slug}`}
        className="flex h-full min-h-11 flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition-shadow outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-surface-subtle">
          {cover ? (
            <Image
              src={cover.url}
              alt={cover.altText}
              fill
              sizes={CARD_IMAGE_SIZES}
              className="object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Image unavailable
            </div>
          )}
          <div className="absolute top-3 left-3">
            <VehicleStatusBadge presentation={vehicle.presentation} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <h2 className="text-base font-semibold text-balance">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {driverLabel(vehicle.driverOption)}
            </p>
          </div>
          <PriceDisplay
            presentation={vehicle.presentation}
            salePrice={vehicle.salePrice}
            rentalDailyPrice={vehicle.rentalDailyPrice}
            minRentalDays={vehicle.minRentalDays}
            className="mt-auto"
          />
          {vehicle.location ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPinIcon aria-hidden="true" className="size-3.5" />
              {vehicle.location}
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
