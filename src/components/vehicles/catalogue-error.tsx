"use client";

import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared catalogue error presentation.
 *
 * A presentational boundary body suitable for a route `error.tsx`: it shows a
 * safe, generic message (never a raw provider or database error) and an
 * optional retry action wired to Next.js's `reset`.
 */
export function CatalogueError({
  title = "Something went wrong",
  description = "We couldn't load these vehicles just now. Please try again.",
  reset,
  className,
}: {
  title?: string;
  description?: string;
  reset?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed bg-surface-subtle px-6 py-16 text-center",
        className,
      )}
    >
      <AlertTriangleIcon
        aria-hidden="true"
        className="size-8 text-muted-foreground"
      />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {reset ? (
        <Button onClick={reset} variant="outline" className="mt-6">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
