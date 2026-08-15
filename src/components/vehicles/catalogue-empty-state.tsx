import { CarFrontIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared, accessible empty state for any catalogue listing. Rendered as a
 * status region so assistive technology announces that no vehicles matched.
 */
export function CatalogueEmptyState({
  title = "No vehicles available",
  description = "There are no vehicles to show here right now. Please check back soon.",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed bg-surface-subtle px-6 py-16 text-center",
        className,
      )}
    >
      <CarFrontIcon
        aria-hidden="true"
        className="size-8 text-muted-foreground"
      />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
