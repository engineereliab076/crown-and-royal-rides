import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Centered, width-constrained page container.
 *
 * Enforces the shared maximum content width and responsive horizontal padding
 * (16px mobile / 24px tablet / 32px desktop). It intentionally applies no
 * vertical spacing so callers control their own rhythm.
 */
export interface ContainerProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Semantic element to render. Kept to a small, type-safe set. */
  as?: "div" | "section";
}

export function Container({
  as: Component = "div",
  className,
  ...props
}: ContainerProps): React.ReactElement {
  return (
    <Component
      className={cn(
        "mx-auto w-full max-w-[var(--container-max)] px-4 sm:px-6 lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
