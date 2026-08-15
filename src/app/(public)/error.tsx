"use client";

import { CatalogueError } from "@/components/vehicles/catalogue-error";
import { Container } from "@/components/layout/container";

export default function PublicError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="flex-1 py-16">
      <Container>
        <CatalogueError
          title="We couldn't load this page"
          description="Something went wrong while loading this page. Please try again."
          reset={reset}
        />
      </Container>
    </main>
  );
}
