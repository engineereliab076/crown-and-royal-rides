import {
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { JsonLd } from "@/components/json-ld";
import { Container } from "@/components/layout/container";
import { VehicleGrid } from "@/components/vehicles/vehicle-grid";
import { publicPageMetadata, publicUrl } from "@/lib/public-metadata";
import { buildBusinessStructuredData } from "@/lib/structured-data";
import {
  getCachedFeatured,
  getCachedRentalStrip,
  getCachedSaleStrip,
} from "@/server/cache/vehicles";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";
import { getPublicCatalogueService } from "@/server/vehicles/services";

export function generateMetadata(): Metadata {
  return publicPageMetadata({
    path: "/",
    title: "Vehicle sales and rentals in Tanzania",
    description:
      "Browse carefully presented vehicles for sale and rent with direct local assistance.",
  });
}

const linkButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="text-eyebrow font-semibold tracking-widest text-brand-gold-foreground uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-section font-semibold text-balance">{title}</h2>
    </div>
  );
}

export default async function HomePage() {
  const service = getPublicCatalogueService();
  const [settings, featured, sale, rental] = await Promise.all([
    getPublicSettingsPresentation(),
    getCachedFeatured(() => service.listFeatured()),
    getCachedSaleStrip(() => service.listSaleStrip()),
    getCachedRentalStrip(() => service.listRentalStrip()),
  ]);
  const heroVehicle = featured.find((vehicle) => vehicle.coverImage !== null);
  const businessStructuredData = buildBusinessStructuredData({
    settings,
    canonicalUrl: publicUrl("/").toString(),
  });

  return (
    <main id="main-content" className="flex-1">
      <JsonLd data={businessStructuredData} />
      <section className="overflow-hidden border-b bg-primary text-primary-foreground">
        <Container className="grid min-h-[34rem] items-stretch gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="flex max-w-2xl flex-col justify-center">
            <p className="text-eyebrow font-semibold tracking-widest text-brand-gold uppercase">
              {settings.businessName}
            </p>
            <h1 className="mt-5 text-display font-semibold text-balance">
              {settings.heroHeadline}
            </h1>
            <p className="mt-6 max-w-xl text-body-lg text-primary-foreground/75">
              {settings.heroSubheadline}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/cars"
                className={`${linkButton} bg-brand-gold text-brand-gold-foreground hover:brightness-105`}
              >
                Browse vehicles
              </Link>
              <Link
                href="/contact"
                className={`${linkButton} border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10`}
              >
                Contact us
              </Link>
            </div>
          </div>
          {heroVehicle?.coverImage ? (
            <Link
              href={`/cars/${heroVehicle.slug}`}
              className="group relative min-h-72 overflow-hidden rounded-2xl border border-white/15 bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-brand-gold lg:min-h-full"
            >
              <Image
                src={heroVehicle.coverImage.url}
                alt={heroVehicle.coverImage.altText}
                fill
                priority
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.02]"
              />
              <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent p-6 pt-20 text-white">
                <p className="text-xs font-semibold tracking-widest uppercase">
                  Featured vehicle
                </p>
                <p className="mt-1 text-xl font-semibold">
                  {heroVehicle.year} {heroVehicle.brandName} {heroVehicle.model}
                </p>
              </div>
            </Link>
          ) : (
            <div
              aria-hidden="true"
              className="relative hidden min-h-80 overflow-hidden rounded-2xl border border-white/15 bg-white/5 lg:block"
            >
              <div className="absolute inset-8 rounded-full border border-brand-gold/30" />
              <div className="absolute top-1/2 right-10 left-10 h-px bg-brand-gold/50" />
              <div className="absolute right-14 bottom-14 size-20 rounded-full bg-brand-gold/10" />
            </div>
          )}
        </Container>
      </section>

      {featured.length > 0 ? (
        <section className="py-14 sm:py-20">
          <Container>
            <SectionHeading
              eyebrow="Selected for you"
              title="Featured vehicles"
            />
            <VehicleGrid
              vehicles={featured}
              aria-label="Featured vehicles"
              className="mt-8 xl:grid-cols-4"
            />
          </Container>
        </section>
      ) : null}

      <section className="border-y bg-surface-subtle py-14 sm:py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading eyebrow="Ownership" title="Vehicles for sale" />
            <Link
              href="/cars-for-sale"
              className={`${linkButton} border bg-background hover:bg-accent`}
            >
              View all for sale
            </Link>
          </div>
          {sale.length > 0 ? (
            <VehicleGrid
              vehicles={sale}
              aria-label="Vehicles for sale"
              className="mt-8 xl:grid-cols-4"
            />
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              No sale vehicles are available right now. Our team can still help
              with general enquiries.
            </p>
          )}
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Flexible journeys"
              title="Vehicles for rent"
            />
            <Link
              href="/cars-for-rent"
              className={`${linkButton} border hover:bg-accent`}
            >
              View all for rent
            </Link>
          </div>
          {rental.length > 0 ? (
            <VehicleGrid
              vehicles={rental}
              aria-label="Vehicles for rent"
              className="mt-8 xl:grid-cols-4"
            />
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              No rental vehicles are available right now. Please check back
              soon.
            </p>
          )}
        </Container>
      </section>

      <section className="border-y bg-primary py-14 text-primary-foreground sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Why choose us"
            title="Straightforward help for the road ahead"
          />
          <ul className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 sm:grid-cols-2 lg:grid-cols-4">
            {[
              "Carefully presented vehicles",
              "Direct human assistance",
              "Sale and rental options",
              "Locally relevant support",
            ].map((benefit) => (
              <li
                key={benefit}
                className="bg-primary p-6 text-base font-medium"
              >
                {benefit}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container className="grid gap-8 rounded-2xl border bg-card p-6 shadow-soft sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <SectionHeading
              eyebrow="Talk to our team"
              title="Ready to discuss a vehicle?"
            />
            <p className="mt-4 max-w-xl text-muted-foreground">
              Contact us directly for current vehicle details, purchase
              questions, or rental arrangements.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {settings.whatsappUrl ? (
                <a
                  href={settings.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${linkButton} bg-primary text-primary-foreground`}
                >
                  <MessageCircleIcon
                    aria-hidden="true"
                    className="mr-2 size-4"
                  />
                  WhatsApp
                </a>
              ) : null}
              <Link
                href="/contact"
                className={`${linkButton} border hover:bg-accent`}
              >
                All contact details
              </Link>
            </div>
          </div>
          <address className="not-italic lg:min-w-72">
            <ul className="space-y-2 text-sm text-muted-foreground">
              {settings.primaryPhoneUrl && settings.primaryPhone ? (
                <li>
                  <a
                    href={settings.primaryPhoneUrl}
                    className="flex min-h-11 items-center gap-3 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PhoneIcon aria-hidden="true" className="size-4" />
                    {settings.primaryPhone}
                  </a>
                </li>
              ) : null}
              {settings.emailUrl && settings.email ? (
                <li>
                  <a
                    href={settings.emailUrl}
                    className="flex min-h-11 items-center gap-3 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MailIcon aria-hidden="true" className="size-4" />
                    {settings.email}
                  </a>
                </li>
              ) : null}
              {settings.address ? (
                <li className="flex min-h-11 items-center gap-3">
                  <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
                  {settings.address}
                </li>
              ) : null}
            </ul>
          </address>
        </Container>
      </section>
    </main>
  );
}
