import { describe, expect, it } from "vitest";

import {
  buildBusinessStructuredData,
  buildVehicleStructuredData,
  serializeJsonLd,
} from "@/lib/structured-data";
import { resolveVehiclePublicState } from "@/lib/vehicle-public-state";
import type { PublicVehicleDetail } from "@/server/modules/vehicles/public-dto";
import type { PublicSettingsPresentation } from "@/server/settings/public-presentation";

function vehicle(
  overrides: Partial<PublicVehicleDetail> = {},
): PublicVehicleDetail {
  return {
    id: "vehicle-id",
    slug: "toyota-rav4-2025-safe",
    brandName: "Toyota",
    model: "RAV4",
    year: 2025,
    bodyType: "suv",
    condition: "foreign_used",
    transmission: "automatic",
    fuelType: "petrol",
    driverOption: "without_driver",
    driverNote: null,
    isForSale: true,
    saleStatus: "available",
    salePrice: 90_000_000,
    isNegotiable: false,
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    location: "Dar es Salaam",
    mileageKm: 20_000,
    engineCc: 2000,
    engineDescription: null,
    seats: 5,
    doors: 5,
    exteriorColor: "White",
    interiorColor: "Black",
    drivetrain: "awd",
    features: [],
    isFeatured: false,
    description: "A safe public description.",
    coverImage: null,
    images: [
      {
        id: "image-id",
        url: "https://res.cloudinary.com/demo/image/upload/car.jpg",
        width: 1200,
        height: 800,
        altText: "Toyota RAV4",
        isCover: true,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

function presentation(
  input: {
    listingState?: string;
    isForSale?: boolean;
    saleStatus?: string | null;
    salePrice?: number | null;
    isForRent?: boolean;
    rentalStatus?: string | null;
    rentalDailyPrice?: number | null;
    minRentalDays?: number | null;
  } = {},
) {
  return resolveVehiclePublicState({
    listingState: input.listingState ?? "published",
    isForSale: input.isForSale ?? true,
    saleStatus: input.saleStatus ?? "available",
    salePrice: input.salePrice ?? 90_000_000,
    isForRent: input.isForRent ?? false,
    rentalStatus: input.rentalStatus ?? null,
    rentalDailyPrice: input.rentalDailyPrice ?? null,
    minRentalDays: input.minRentalDays ?? null,
  });
}

const url = "https://example.test/cars/toyota-rav4-2025-safe";

describe("vehicle structured data", () => {
  it("maps sale, rental, and dual actionable offers", () => {
    const sale = buildVehicleStructuredData({
      vehicle: vehicle(),
      presentation: presentation(),
      canonicalUrl: url,
    });
    const rentalVehicle = vehicle({
      isForSale: false,
      saleStatus: null,
      salePrice: null,
      isForRent: true,
      rentalStatus: "available",
      rentalDailyPrice: 200_000,
      minRentalDays: 2,
    });
    const rentalPresentation = presentation({
      isForSale: false,
      saleStatus: null,
      salePrice: null,
      isForRent: true,
      rentalStatus: "available",
      rentalDailyPrice: 200_000,
      minRentalDays: 2,
    });
    const rental = buildVehicleStructuredData({
      vehicle: rentalVehicle,
      presentation: rentalPresentation,
      canonicalUrl: url,
    });
    const dualVehicle = vehicle({
      isForRent: true,
      rentalStatus: "available",
      rentalDailyPrice: 250_000,
      minRentalDays: 1,
    });
    const dual = buildVehicleStructuredData({
      vehicle: dualVehicle,
      presentation: presentation({
        isForRent: true,
        rentalStatus: "available",
        rentalDailyPrice: 250_000,
        minRentalDays: 1,
      }),
      canonicalUrl: url,
    });
    expect(JSON.parse(serializeJsonLd(sale!)).offers).toMatchObject({
      priceCurrency: "TZS",
      price: 90_000_000,
    });
    expect(
      JSON.parse(serializeJsonLd(rental!)).offers.priceSpecification,
    ).toMatchObject({ unitCode: "DAY", price: 200_000 });
    expect(JSON.parse(serializeJsonLd(dual!)).offers).toHaveLength(2);
  });

  it("omits offers for reserved vehicles and omits all data for sold or retired vehicles", () => {
    const reserved = buildVehicleStructuredData({
      vehicle: vehicle({ saleStatus: "reserved" }),
      presentation: presentation({ saleStatus: "reserved" }),
      canonicalUrl: url,
    });
    expect(JSON.parse(serializeJsonLd(reserved!))).not.toHaveProperty("offers");
    expect(
      buildVehicleStructuredData({
        vehicle: vehicle({ saleStatus: "sold" }),
        presentation: presentation({ saleStatus: "sold" }),
        canonicalUrl: url,
      }),
    ).toBeNull();
    expect(
      buildVehicleStructuredData({
        vehicle: vehicle(),
        presentation: presentation({ listingState: "archived" }),
        canonicalUrl: url,
      }),
    ).toBeNull();
  });

  it("escapes script-breaking characters", () => {
    const data = buildVehicleStructuredData({
      vehicle: vehicle({
        description: "</script><img src=x>&before\u2028middle\u2029after",
      }),
      presentation: presentation(),
      canonicalUrl: url,
    });
    const serialized = serializeJsonLd(data!);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
  });
});

describe("business structured data allow-list", () => {
  const settings: PublicSettingsPresentation = {
    businessName: "Crown and Royal Rides",
    heroHeadline: "Headline",
    heroSubheadline: "Subheadline",
    whatsappNumber: "+255712345678",
    whatsappUrl: "https://wa.me/255712345678",
    primaryPhone: "+255712345678",
    primaryPhoneUrl: "tel:+255712345678",
    secondaryPhone: null,
    secondaryPhoneUrl: null,
    email: "hello@example.test",
    emailUrl: "mailto:hello@example.test",
    address: "Dar es Salaam, Tanzania",
    openingHours: { monday: "08:00-17:00" },
    socialLinks: { instagram: "https://instagram.com/example" },
  };

  it("emits safe public contact fields and valid opening hours only", () => {
    const data = buildBusinessStructuredData({
      settings,
      canonicalUrl: "https://example.test/",
    });
    const serialized = serializeJsonLd(data);
    const parsed = JSON.parse(serialized);
    expect(parsed["@graph"]).toHaveLength(1);
    expect(parsed["@graph"][0]).toMatchObject({
      name: settings.businessName,
      telephone: settings.primaryPhone,
      email: settings.email,
      sameAs: ["https://instagram.com/example"],
    });
    expect(parsed["@graph"][0].openingHoursSpecification).toHaveLength(1);
    expect(serialized).not.toContain("heroHeadline");
  });

  it("omits malformed opening hours and arbitrary extra records", () => {
    const unsafe = {
      ...settings,
      openingHours: { monday: "whenever" },
      internalId: "secret-id",
      notificationRecipients: ["private@example.test"],
    };
    const serialized = serializeJsonLd(
      buildBusinessStructuredData({
        settings: unsafe,
        canonicalUrl: "https://example.test/",
      }),
    );
    expect(serialized).not.toContain("openingHoursSpecification");
    expect(serialized).not.toContain("secret-id");
    expect(serialized).not.toContain("private@example.test");
  });
});
