import { Container } from "@/components/layout/container";
import { siteConfig } from "@/lib/site";

export default function Home() {
  return (
    <main id="main-content" className="flex-1">
      <Container as="section" className="py-16 sm:py-24 lg:py-32">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="max-w-xl">
            <p className="text-eyebrow font-medium text-muted-foreground uppercase">
              {siteConfig.name}
            </p>
            <h1 className="mt-4 text-display font-semibold text-balance text-foreground">
              A considered way to find your next vehicle.
            </h1>
            <p className="mt-6 max-w-prose text-body-lg text-muted-foreground">
              We are preparing a refined digital home for Crown and Royal
              Rides&mdash;bringing our vehicle sales, rentals, and destination
              journeys together in one place. The showroom is being built with
              the same care we bring to the road.
            </p>
            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-4 py-2 text-body-sm font-medium text-muted-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-brand-gold"
              />
              Digital showroom coming soon
            </div>
          </div>

          {/* Decorative composition only; conveys no information. */}
          <div
            aria-hidden="true"
            className="relative hidden aspect-4/3 w-full overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-soft lg:block"
          >
            <div className="absolute inset-6 rounded-xl border border-border/70 bg-surface-subtle" />
            <div className="absolute top-10 left-10 h-px w-24 bg-brand-gold" />
            <div className="absolute right-10 bottom-10 size-16 rounded-full border border-brand-gold/40" />
            <div className="absolute right-12 bottom-12 size-8 rounded-full bg-brand-gold/15" />
          </div>
        </div>
      </Container>
    </main>
  );
}
