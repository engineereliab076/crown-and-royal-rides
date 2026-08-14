import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { ContactActions } from "@/components/contact-actions";
import { VehicleGallery } from "@/components/vehicle-gallery";
import { env } from "@/lib/env";
import {
  buildDirectVehicleWhatsAppMessage,
  buildWhatsAppUrl,
} from "@/lib/whatsapp";
import { vehiclePublicPresentation } from "@/lib/vehicle-public";
import { getCachedPublicVehicle } from "@/server/cache/vehicles";
import { isAppError } from "@/server/http/errors";
import type { VehiclePublicDetailDTO } from "@/server/modules/vehicles/dto";
import { getPublicVehicleService } from "@/server/vehicles/services";
import { getInquiryRuntimeServices } from "@/server/inquiries/services";

export const revalidate = 300;

async function loadVehicle(slug: string): Promise<VehiclePublicDetailDTO> {
  try {
    return await getCachedPublicVehicle(slug, () =>
      getPublicVehicleService().getPublicBySlug(slug),
    );
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await loadVehicle(slug);
  const presentation = vehiclePublicPresentation(vehicle);
  return {
    title: presentation.title,
    description: presentation.description,
    alternates: {
      canonical: new URL(`/cars/${vehicle.slug}`, env.NEXT_PUBLIC_APP_URL),
    },
  };
}

export default async function VehiclePublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vehicle = await loadVehicle(slug);
  const presentation = vehiclePublicPresentation(vehicle);
  let directWhatsAppUrl: string | null = null;
  if (vehicle.isForSale && vehicle.saleStatus === "available") {
    try {
      const runtime = getInquiryRuntimeServices();
      const settings = await runtime.settingsRepository.findSingleton();
      if (settings !== null) {
        directWhatsAppUrl = buildWhatsAppUrl(
          settings.whatsappNumber,
          buildDirectVehicleWhatsAppMessage({
            brandName: vehicle.brandName,
            model: vehicle.model,
            year: vehicle.year,
            salePrice: vehicle.salePrice,
            vehicleUrl: new URL(
              `/cars/${vehicle.slug}`,
              runtime.publicOrigin,
            ).toString(),
          }),
        );
      }
    } catch {
      directWhatsAppUrl = null;
    }
  }
  const details = [
    ["Body type", presentation.bodyType],
    ["Condition", presentation.condition],
    ["Transmission", presentation.transmission],
    ["Fuel type", presentation.fuelType],
    ["Driver option", presentation.driverOption],
  ] as const;

  return (
    <main id="main-content" className="flex-1 py-10 sm:py-16">
      <Container className="space-y-8">
        <div>
          <p className="text-eyebrow font-medium text-muted-foreground uppercase">
            Vehicle for sale
          </p>
          <h1 className="mt-3 text-title font-semibold text-balance">
            {presentation.title}
          </h1>
          <p className="mt-4 text-xl font-semibold text-brand-gold-foreground">
            {presentation.price}
          </p>
        </div>
        <VehicleGallery images={vehicle.images} title={presentation.title} />
        <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
          <dl className="grid grid-cols-2 gap-5 rounded-2xl border bg-card p-5 shadow-soft lg:grid-cols-1">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="rounded-2xl border bg-card p-5 shadow-soft sm:p-7">
            <h2 className="text-xl font-semibold">About this vehicle</h2>
            <p className="mt-4 text-body whitespace-pre-wrap text-muted-foreground">
              {vehicle.description ?? "Description unavailable."}
            </p>
          </section>
        </div>
        {vehicle.isForSale && vehicle.saleStatus === "available" ? (
          <ContactActions
            vehicleId={vehicle.id}
            directWhatsAppUrl={directWhatsAppUrl}
          />
        ) : (
          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Currently unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This vehicle is not currently accepting purchase requests.
            </p>
          </section>
        )}
      </Container>
    </main>
  );
}
