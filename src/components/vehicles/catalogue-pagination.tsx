import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { PaginatedResult } from "@/lib/pagination";
import {
  catalogueHref,
  type AppliedFilters,
  type VehicleSort,
} from "@/lib/vehicle-filters";

/**
 * Public catalogue pagination controls.
 *
 * Links are built exclusively from normalized applied state. Raw, ignored, and
 * unknown request values therefore cannot leak into navigation.
 */

const CONTROL_CLASS =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CataloguePagination({
  basePath,
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  appliedFilters,
  sort,
  className,
}: {
  basePath: string;
  appliedFilters: AppliedFilters;
  sort: VehicleSort;
} & Pick<
  PaginatedResult<unknown>,
  "page" | "totalPages" | "hasPreviousPage" | "hasNextPage"
> & { className?: string }) {
  if (totalPages <= 1) return null;
  const hrefForPage = (targetPage: number) =>
    catalogueHref(basePath, {
      appliedFilters,
      sort,
      page: targetPage,
    });
  const firstVisible = Math.max(1, Math.min(page - 2, totalPages - 4));
  const lastVisible = Math.min(totalPages, firstVisible + 4);
  const pageNumbers = Array.from(
    { length: lastVisible - firstVisible + 1 },
    (_value, index) => firstVisible + index,
  );
  return (
    <nav
      aria-label="Catalogue pagination"
      className={cn(
        "flex flex-wrap items-center justify-center gap-2",
        className,
      )}
    >
      {hasPreviousPage ? (
        <Link
          href={hrefForPage(page - 1)}
          rel="prev"
          aria-label="Previous catalogue page"
          className={CONTROL_CLASS}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          Previous
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            CONTROL_CLASS,
            "cursor-not-allowed text-muted-foreground",
          )}
        >
          <ChevronLeftIcon className="size-4" />
          Previous
        </span>
      )}

      <div
        className="flex flex-wrap justify-center gap-1"
        aria-label={`Page ${page} of ${totalPages}`}
      >
        {pageNumbers.map((pageNumber) => (
          <Link
            key={pageNumber}
            href={hrefForPage(pageNumber)}
            aria-label={`Go to catalogue page ${pageNumber}`}
            aria-current={pageNumber === page ? "page" : undefined}
            className={cn(
              CONTROL_CLASS,
              pageNumber === page &&
                "border-primary bg-primary text-primary-foreground",
            )}
          >
            {pageNumber}
          </Link>
        ))}
      </div>

      {hasNextPage ? (
        <Link
          href={hrefForPage(page + 1)}
          rel="next"
          aria-label="Next catalogue page"
          className={CONTROL_CLASS}
        >
          Next
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            CONTROL_CLASS,
            "cursor-not-allowed text-muted-foreground",
          )}
        >
          Next
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </nav>
  );
}
