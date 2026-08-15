import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { publicUrl } from "@/lib/public-metadata";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about our vehicle sale and rental assistance in Tanzania.",
  alternates: { canonical: publicUrl("/about") },
};

export default async function AboutPage() {
  const settings = await getPublicSettingsPresentation();
  return (
    <main id="main-content" className="flex-1">
      <section className="border-b bg-primary py-16 text-primary-foreground sm:py-24">
        <Container className="max-w-4xl">
          <p className="text-eyebrow font-semibold tracking-widest text-brand-gold uppercase">
            About {settings.businessName}
          </p>
          <h1 className="mt-4 text-display font-semibold text-balance">
            {settings.heroHeadline}
          </h1>
          <p className="mt-6 max-w-2xl text-body-lg text-primary-foreground/75">
            {settings.heroSubheadline}
          </p>
        </Container>
      </section>
      <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6 text-body-lg text-muted-foreground">
          <h2 className="text-section font-semibold text-foreground">
            Vehicle choices with direct, local help
          </h2>
          <p>
            {settings.businessName} helps customers explore vehicles for sale or
            rental in Tanzania. Our public catalogue brings the available
            choices together, while our team provides direct assistance with the
            next conversation.
          </p>
          <p>
            Sale enquiries are handled as purchase requests. Rental availability
            and arrangements are confirmed directly with the team by phone or
            WhatsApp. Browsing the catalogue does not reserve, purchase, or book
            a vehicle.
          </p>
        </div>
        <aside
          className="rounded-2xl border bg-card p-6 shadow-soft"
          aria-labelledby="about-contact-heading"
        >
          <h2 id="about-contact-heading" className="text-xl font-semibold">
            How can we help?
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Browse the current collection or contact the team to discuss what
            you need.
          </p>
          <div className="mt-6 grid gap-3">
            <Link
              href="/cars"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Browse vehicles
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border px-5 font-semibold focus-visible:ring-2 focus-visible:ring-ring"
            >
              Contact us
            </Link>
          </div>
        </aside>
      </Container>
    </main>
  );
}
