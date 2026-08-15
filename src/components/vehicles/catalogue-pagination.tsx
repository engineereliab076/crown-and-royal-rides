import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { PaginatedResult } from "@/lib/pagination";

/**
 * Public catalogue pagination controls.
 *
 * The URL surface is `page`-only — no search or filter parameters are ever
 * emitted (those are deferred to Phase 7). Page 1 links to the clean base path
 * so the first page has a single canonical URL. Controls meet the 44×44px touch
 * target and remain fully keyboard accessible.
 */

function hrefForPage(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

const CONTROL_CLASS =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CataloguePagination({
  basePath,
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  className,
}: {
  basePath: string;
} & Pick<
  PaginatedResult<unknown>,
  "page" | "totalPages" | "hasPreviousPage" | "hasNextPage"
> & { className?: string }) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Catalogue pagination"
      className={cn("flex items-center justify-between gap-4", className)}
    >
      {hasPreviousPage ? (
        <Link
          href={hrefForPage(basePath, page - 1)}
          rel="prev"
          className={CONTROL_CLASS}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          Previous
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(CONTROL_CLASS, "cursor-not-allowed opacity-40")}
        >
          <ChevronLeftIcon className="size-4" />
          Previous
        </span>
      )}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>

      {hasNextPage ? (
        <Link
          href={hrefForPage(basePath, page + 1)}
          rel="next"
          className={CONTROL_CLASS}
        >
          Next
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(CONTROL_CLASS, "cursor-not-allowed opacity-40")}
        >
          Next
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </nav>
  );
}
