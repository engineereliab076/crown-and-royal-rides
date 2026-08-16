import { ChevronRightIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContactActions } from "@/components/contact-actions";
import { JsonLd } from "@/components/json-ld";
import { Container } from "@/components/layout/container";
import { VehicleGallery } from "@/components/vehicle-gallery";
import { PriceDisplay } from "@/components/vehicles/price-display";
import { StickyMobileActions } from "@/components/vehicles/sticky-mobile-actions";
import { VehicleGrid } from "@/components/vehicles/vehicle-grid";
import { VehicleSpecTable } from "@/components/vehicles/vehicle-spec-table";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { publicUrl, vehicleDetailMetadata } from "@/lib/public-metadata";
import { buildVehicleStructuredData } from "@/lib/structured-data";
import {
  buildDirectVehicleWhatsAppMessage,
  buildWhatsAppUrl,
} from "@/lib/whatsapp";
import { getCachedPublicVehicleDetail } from "@/server/cache/vehicles";
import { isAppError } from "@/server/http/errors";
import type { PublicVehicleDetailResult } from "@/server/modules/vehicles/public-dto";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";
import { getPublicCatalogueService } from "@/server/vehicles/services";

async function loadVehicle(slug: string): Promise<PublicVehicleDetailResult> {
  try {
    return await getCachedPublicVehicleDetail(slug, () =>
      getPublicCatalogueService().getPublicDetail(slug),
    );
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
}

function detailTitle(vehicle: PublicVehicleDetailResult["vehicle"]): string {
  return `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return vehicleDetailMetadata(await loadVehicle(slug));
}

function StateNotice({
  state,
  reserved,
}: {
  state: string;
  reserved: boolean;
}) {
  const content = reserved
    ? [
        "Reserved",
        "This vehicle remains visible while reserved, but it is not accepting purchase or rental requests.",
      ]
    : state === "sold-historical"
      ? [
          "This vehicle has been sold",
          "This page is retained as a historical vehicle record. Explore the related available vehicles below.",
        ]
      : state === "retired"
        ? [
            "No longer available",
            "This vehicle has been retired from the active catalogue and is not accepting enquiries.",
          ]
        : [
            "Currently unavailable",
            "This vehicle is not accepting purchase or rental requests at this time.",
          ];
  return (
    <section
      className="rounded-2xl border bg-surface-subtle p-5"
      aria-labelledby="availability-heading"
    >
      <h2 id="availability-heading" className="font-semibold">
        {content[0]}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{content[1]}</p>
    </section>
  );
}

export default async function VehiclePublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [{ vehicle, presentation, related }, settings] = await Promise.all([
    loadVehicle(slug),
    getPublicSettingsPresentation(),
  ]);
  const title = detailTitle(vehicle);
  const canonicalUrl = publicUrl(`/cars/${vehicle.slug}`).toString();
  const structuredData = buildVehicleStructuredData({
    vehicle,
    presentation,
    canonicalUrl,
  });
  const modes = [
    presentation.saleActionable ? "sale" : null,
    presentation.rentalActionable ? "rental" : null,
  ].filter((mode): mode is "sale" | "rental" => mode !== null);
  let whatsappUrl: string | null = null;
  if (presentation.whatsappAllowed && settings.whatsappNumber) {
    try {
      whatsappUrl = buildWhatsAppUrl(
        settings.whatsappNumber,
        buildDirectVehicleWhatsAppMessage({
          brandName: vehicle.brandName,
          model: vehicle.model,
          year: vehicle.year,
          salePrice: vehicle.salePrice,
          vehicleUrl: publicUrl(`/cars/${vehicle.slug}`).toString(),
          modes,
        }),
      );
    } catch {
      whatsappUrl = null;
    }
  }
  const phoneUrl = presentation.rentalActionable
    ? settings.primaryPhoneUrl
    : null;
  const hasStickyAction =
    presentation.saleActionable || whatsappUrl !== null || phoneUrl !== null;
  const reserved =
    presentation.state === "active" &&
    !presentation.saleActionable &&
    !presentation.rentalActionable;
  return (
    <main
      id="main-content"
      className={`flex-1 py-8 sm:py-12 ${hasStickyAction ? "pb-24 md:pb-12" : ""}`}
    >
      {structuredData ? <JsonLd data={structuredData} /> : null}
      <Container className="space-y-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <li>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Home
              </Link>
            </li>
            <li>
              <ChevronRightIcon aria-hidden="true" className="size-4" />
            </li>
            <li>
              <Link
                href="/cars"
                className="inline-flex min-h-11 items-center rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Vehicles
              </Link>
            </li>
            <li>
              <ChevronRightIcon aria-hidden="true" className="size-4" />
            </li>
            <li aria-current="page" className="truncate text-foreground">
              {title}
            </li>
          </ol>
        </nav>
        <header>
          <VehicleStatusBadge presentation={presentation} />
          <h1 className="mt-3 text-title font-semibold text-balance">
            {title}
          </h1>
          <PriceDisplay
            presentation={presentation}
            salePrice={vehicle.salePrice}
            rentalDailyPrice={vehicle.rentalDailyPrice}
            minRentalDays={vehicle.minRentalDays}
            className="mt-4"
          />
        </header>
        <VehicleGallery images={vehicle.images} title={title} />
        <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
          <VehicleSpecTable
            vehicle={vehicle}
            className="rounded-2xl border bg-card p-5 shadow-soft"
          />
          <div className="space-y-6">
            <section className="rounded-2xl border bg-card p-5 shadow-soft sm:p-7">
              <h2 className="text-xl font-semibold">About this vehicle</h2>
              <p className="mt-4 whitespace-pre-wrap text-muted-foreground">
                {vehicle.description?.trim() ||
                  "A detailed description is not available. Contact our team for more information."}
              </p>
            </section>
            {vehicle.features.length > 0 ? (
              <section className="rounded-2xl border bg-card p-5 shadow-soft sm:p-7">
                <h2 className="text-xl font-semibold">Features</h2>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {vehicle.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex gap-2 text-sm text-muted-foreground"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-gold-foreground"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
        {presentation.saleActionable ? (
          <ContactActions
            vehicleId={vehicle.id}
            directWhatsAppUrl={whatsappUrl}
          />
        ) : null}
        {presentation.rentalActionable ? (
          <section
            className="rounded-2xl border bg-card p-5 shadow-soft sm:p-7"
            aria-labelledby="rental-contact-heading"
          >
            <h2 id="rental-contact-heading" className="text-xl font-semibold">
              Arrange this rental
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Rental availability, dates, driver arrangements, and final terms
              are confirmed directly with our team. This website does not take
              online bookings or payments.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageCircleIcon aria-hidden="true" className="size-4" />
                  Discuss on WhatsApp
                </a>
              ) : null}
              {phoneUrl ? (
                <a
                  href={phoneUrl}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-5 font-semibold focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PhoneIcon aria-hidden="true" className="size-4" />
                  Call the team
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
        {!presentation.saleActionable && !presentation.rentalActionable ? (
          <StateNotice state={presentation.state} reserved={reserved} />
        ) : null}
        {related.length > 0 ? (
          <section aria-labelledby="related-heading" className="space-y-6">
            <h2 id="related-heading" className="text-section font-semibold">
              Other available vehicles
            </h2>
            <VehicleGrid
              vehicles={related}
              aria-label="Related vehicles"
              className="xl:grid-cols-4"
            />
          </section>
        ) : null}
      </Container>
      {hasStickyAction ? (
        <StickyMobileActions
          showPurchase={presentation.saleActionable}
          whatsappUrl={whatsappUrl}
          phoneUrl={phoneUrl}
        />
      ) : null}
    </main>
  );
}
