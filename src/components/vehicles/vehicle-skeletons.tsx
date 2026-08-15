import { cn } from "@/lib/utils";

/**
 * Loading skeleton primitives for the catalogue card, grid, and detail view.
 * Purely decorative: hidden from assistive technology while content loads.
 */

export function VehicleCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-full overflow-hidden rounded-2xl border bg-card shadow-soft",
        className,
      )}
    >
      <div className="aspect-video w-full animate-pulse bg-surface-subtle" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-subtle" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-subtle" />
        <div className="h-5 w-1/2 animate-pulse rounded bg-surface-subtle" />
      </div>
    </div>
  );
}

export function VehicleGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <VehicleCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function VehicleDetailSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-8", className)}>
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-subtle" />
        <div className="h-6 w-40 animate-pulse rounded bg-surface-subtle" />
      </div>
      <div className="aspect-video w-full animate-pulse rounded-2xl bg-surface-subtle" />
      <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
        <div className="h-64 animate-pulse rounded-2xl bg-surface-subtle" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface-subtle" />
      </div>
    </div>
  );
}
