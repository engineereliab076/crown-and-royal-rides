import Link from "next/link";
import { Container } from "@/components/layout/container";

export default function NotFound() {
  return (
    <main id="main-content" className="flex flex-1 items-center py-20">
      <Container className="text-center">
        <p className="text-eyebrow font-semibold tracking-widest text-brand-gold-foreground uppercase">
          404
        </p>
        <h1 className="mt-3 text-title font-semibold">Page not found</h1>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">
          The page or vehicle you requested may have moved or is not publicly
          available.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Go home
          </Link>
          <Link
            href="/cars"
            className="inline-flex min-h-11 items-center rounded-lg border px-5 font-semibold focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse vehicles
          </Link>
        </div>
      </Container>
    </main>
  );
}
