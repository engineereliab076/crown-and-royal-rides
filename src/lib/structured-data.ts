import { parseSocialLinks } from "@/lib/public-contact";
import type { VehiclePublicState } from "@/lib/vehicle-public-state";
import type { PublicVehicleDetail } from "@/server/modules/vehicles/public-dto";
import type { PublicSettingsPresentation } from "@/server/settings/public-presentation";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

declare const safeStructuredDataBrand: unique symbol;
export type SafeStructuredData = JsonValue & {
  readonly [safeStructuredDataBrand]: true;
};

function safe<T extends JsonValue>(value: T): SafeStructuredData {
  return value as SafeStructuredData;
}

function positive(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

/** Build allow-listed schema.org data from the public detail DTO only. */
export function buildVehicleStructuredData(input: {
  readonly vehicle: PublicVehicleDetail;
  readonly presentation: VehiclePublicState;
  readonly canonicalUrl: string;
}): SafeStructuredData | null {
  const { vehicle, presentation, canonicalUrl } = input;
  if (!presentation.indexable || presentation.state !== "active") return null;

  const offers: JsonValue[] = [];
  if (
    presentation.saleActionable &&
    presentation.showSalePrice &&
    positive(vehicle.salePrice)
  ) {
    offers.push({
      "@type": "Offer",
      priceCurrency: "TZS",
      price: vehicle.salePrice,
      url: canonicalUrl,
      availability: "https://schema.org/InStock",
    });
  }
  if (
    presentation.rentalActionable &&
    presentation.showRentalPrice &&
    positive(vehicle.rentalDailyPrice)
  ) {
    const rentalOffer: { [key: string]: JsonValue } = {
      "@type": "Offer",
      priceCurrency: "TZS",
      url: canonicalUrl,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: vehicle.rentalDailyPrice,
        priceCurrency: "TZS",
        unitCode: "DAY",
        unitText: "day",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: 1,
          unitCode: "DAY",
        },
      },
    };
    if (vehicle.minRentalDays !== null && vehicle.minRentalDays > 0) {
      rentalOffer.eligibleDuration = {
        "@type": "QuantitativeValue",
        minValue: vehicle.minRentalDays,
        unitCode: "DAY",
      };
    }
    offers.push(rentalOffer);
  }

  const node: { [key: string]: JsonValue } = {
    "@context": "https://schema.org",
    "@type": "Car",
    "@id": `${canonicalUrl}#vehicle`,
    name: `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`,
    url: canonicalUrl,
    brand: { "@type": "Brand", name: vehicle.brandName },
    model: vehicle.model,
    modelDate: String(vehicle.year),
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    vehicleTransmission: vehicle.transmission,
  };
  const images = vehicle.images.map((image) => image.url);
  if (images.length > 0) node.image = images;
  if (vehicle.drivetrain) node.driveWheelConfiguration = vehicle.drivetrain;
  if (vehicle.exteriorColor) node.color = vehicle.exteriorColor;
  if (vehicle.mileageKm !== null && vehicle.mileageKm >= 0) {
    node.mileageFromOdometer = {
      "@type": "QuantitativeValue",
      value: vehicle.mileageKm,
      unitCode: "KMT",
    };
  }
  const description = vehicle.description?.trim();
  if (description) node.description = description;
  if (offers.length === 1) node.offers = offers[0] as JsonValue;
  if (offers.length > 1) node.offers = offers;
  return safe(node);
}

const DAY_MAP: Readonly<Record<string, string>> = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
};

function schemaOpeningHours(value: unknown): JsonValue[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return [];
  const result: JsonValue[] = [];
  for (const [rawDay, rawHours] of entries) {
    const day = DAY_MAP[rawDay.trim().toLowerCase()];
    if (!day || typeof rawHours !== "string") return null;
    const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(rawHours.trim());
    if (!match) return null;
    const [, opens, closes] = match;
    const validTime = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return (
        hour !== undefined && minute !== undefined && hour <= 23 && minute <= 59
      );
    };
    if (!validTime(opens as string) || !validTime(closes as string))
      return null;
    result.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${day}`,
      opens: opens as string,
      closes: closes as string,
    });
  }
  return result;
}

/** Build one coherent allow-listed business graph from public presentation. */
export function buildBusinessStructuredData(input: {
  readonly settings: PublicSettingsPresentation;
  readonly canonicalUrl: string;
}): SafeStructuredData {
  const { settings, canonicalUrl } = input;
  const businessId = `${canonicalUrl}#business`;
  const node: { [key: string]: JsonValue } = {
    "@type": ["Organization", "AutomotiveBusiness"],
    "@id": businessId,
    name: settings.businessName,
    url: canonicalUrl,
  };
  if (settings.primaryPhone) node.telephone = settings.primaryPhone;
  if (settings.email) node.email = settings.email;
  if (settings.address) {
    node.address = {
      "@type": "PostalAddress",
      streetAddress: settings.address,
    };
  }
  const sameAs = parseSocialLinks(settings.socialLinks).map(
    (link) => link.href,
  );
  if (sameAs.length > 0) node.sameAs = sameAs;
  const openingHours = schemaOpeningHours(settings.openingHours);
  if (openingHours && openingHours.length > 0) {
    node.openingHoursSpecification = openingHours;
  }
  return safe({
    "@context": "https://schema.org",
    "@graph": [node],
  });
}

/** Escape JSON for an HTML script text context, including line separators. */
export function serializeJsonLd(value: SafeStructuredData): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
