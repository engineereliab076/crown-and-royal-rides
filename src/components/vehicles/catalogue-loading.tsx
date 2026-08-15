import { Container } from "@/components/layout/container";
import { VehicleGridSkeleton } from "@/components/vehicles/vehicle-skeletons";

/**
 * Shared catalogue loading skeleton for the list routes.
 *
 * Used by the sale/rent route-level `loading.tsx` boundaries and by the `/cars`
 * page's inner `<Suspense>` fallback. The detail route intentionally has no
 * `loading.tsx` in its ancestry: a streamed loading shell would flush a `200`
 * before `notFound()` resolves, turning a missing/draft slug into a soft 404.
 */
export function CatalogueLoadingScreen() {
  return (
    <main id="main-content" className="flex-1 py-12">
      <Container>
        <div
          aria-hidden="true"
          className="mb-10 h-28 max-w-2xl animate-pulse rounded-2xl bg-surface-subtle"
        />
        <VehicleGridSkeleton />
      </Container>
      <span className="sr-only">Loading vehicles</span>
    </main>
  );
}
