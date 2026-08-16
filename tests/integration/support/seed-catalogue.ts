import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Deterministic large-catalogue seeder for the Phase 7 performance benchmark.
 *
 * Produces a realistic, reproducible dataset (fixed PRNG, fixed IDs) covering
 * mixed publication states, commercial modes, enum values, years, prices, and
 * searchable text, with one cover image per vehicle. Insertion is batched. This
 * module performs no timing and no ANALYZE; the benchmark caller owns both.
 */

const BODY_TYPES = [
  "sedan",
  "suv",
  "hatchback",
  "coupe",
  "wagon",
  "pickup",
  "van",
  "convertible",
] as const;
const CONDITIONS = ["brand_new", "foreign_used", "locally_used"] as const;
const TRANSMISSIONS = ["automatic", "manual"] as const;
const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
const DRIVER_OPTIONS = ["with_driver", "without_driver"] as const;
const DRIVETRAINS = ["fwd", "rwd", "awd", "four_wd"] as const;
const SALE_STATUSES = ["available", "reserved", "sold"] as const;
const RENTAL_STATUSES = [
  "available",
  "reserved",
  "rented",
  "unavailable",
] as const;

const BRAND_NAMES = [
  "Toyota",
  "BMW",
  "Mercedes",
  "Nissan",
  "Honda",
  "Suzuki",
  "Mitsubishi",
  "Mazda",
  "Subaru",
  "Volkswagen",
  "Audi",
  "Land Rover",
  "Ford",
  "Hyundai",
  "Kia",
  "Lexus",
  "Isuzu",
  "Peugeot",
] as const;

const MODEL_WORDS = [
  "Corolla",
  "Cruiser",
  "Ranger",
  "Explorer",
  "Sentra",
  "Civic",
  "Vitara",
  "Pajero",
  "Outback",
  "Passat",
  "Defender",
  "Sportage",
  "Harrier",
  "Hilux",
  "Elantra",
] as const;

/** mulberry32 — a tiny deterministic PRNG so every run seeds identical data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function vehicleId(index: number): string {
  return `70000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}
function imageId(index: number): string {
  return `71000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

export interface SeedCatalogueResult {
  readonly vehicleCount: number;
  readonly brandCount: number;
  /** A slug guaranteed to resolve to a published, usable detail page. */
  readonly usableDetailSlug: string;
}

export async function seedLargeCatalogue(
  client: PrismaClient,
  options: { readonly vehicleCount?: number } = {},
): Promise<SeedCatalogueResult> {
  const total = options.vehicleCount ?? 3000;
  const random = mulberry32(0x5eed_7);

  const brands: Prisma.BrandCreateManyInput[] = BRAND_NAMES.map(
    (name, index) => ({
      id: `72000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      sortOrder: index,
    }),
  );
  await client.brand.createMany({ data: brands });

  const vehicles: Prisma.VehicleCreateManyInput[] = [];
  const images: Prisma.VehicleImageCreateManyInput[] = [];
  const publishedBase = Date.UTC(2026, 0, 1);
  let firstUsableSlug: string | null = null;

  for (let i = 0; i < total; i += 1) {
    const brand = brands[i % brands.length]!;
    const brandName = brand.name;
    const model = pick(random, MODEL_WORDS);
    const year = 1990 + Math.floor(random() * 36); // 1990..2025

    // Publication state: ~85% published, ~10% draft, ~5% archived.
    const stateRoll = random();
    const listingState =
      stateRoll < 0.85 ? "published" : stateRoll < 0.95 ? "draft" : "archived";

    // Commercial modes: most rows are for sale, some for rent, some both.
    const modeRoll = random();
    const isForSale = modeRoll < 0.75;
    const isForRent = modeRoll >= 0.5; // overlap 0.5..0.75 => dual mode
    const saleStatus = isForSale ? pick(random, SALE_STATUSES) : null;
    const rentalStatus = isForRent ? pick(random, RENTAL_STATUSES) : null;
    const salePrice = isForSale
      ? BigInt(5_000_000 + Math.floor(random() * 195_000_000))
      : null;
    const rentalDailyPrice = isForRent
      ? BigInt(50_000 + Math.floor(random() * 750_000))
      : null;
    const minRentalDays = isForRent ? 1 + Math.floor(random() * 14) : null;

    const slug = `veh-${i.toString().padStart(4, "0")}-${brand.slug}-${model.toLowerCase()}`;
    if (
      firstUsableSlug === null &&
      listingState === "published" &&
      isForSale &&
      (saleStatus === "available" || saleStatus === "reserved")
    ) {
      firstUsableSlug = slug;
    }

    vehicles.push({
      id: vehicleId(i),
      brandId: brand.id!,
      brandName,
      model,
      slug,
      year,
      bodyType: pick(random, BODY_TYPES),
      condition: pick(random, CONDITIONS),
      transmission: pick(random, TRANSMISSIONS),
      fuelType: pick(random, FUEL_TYPES),
      driverOption: pick(random, DRIVER_OPTIONS),
      drivetrain: pick(random, DRIVETRAINS),
      listingState,
      publishedAt:
        listingState === "published"
          ? new Date(publishedBase + i * 60_000)
          : null,
      isForSale,
      saleStatus,
      salePrice,
      isForRent,
      rentalStatus,
      rentalDailyPrice,
      minRentalDays,
      description: `${brandName} ${model} ${year} in good condition, well maintained.`,
    });

    images.push({
      id: imageId(i),
      vehicleId: vehicleId(i),
      publicId: `perf/${i}`,
      secureUrl: `https://example.test/perf/${i}.jpg`,
      width: 1600,
      height: 900,
      format: "jpg",
      byteSize: 1024,
      altText: `${year} ${brandName} ${model}`,
      sortOrder: 0,
      isCover: true,
    });
  }

  const batchSize = 500;
  for (let start = 0; start < vehicles.length; start += batchSize) {
    await client.vehicle.createMany({
      data: vehicles.slice(start, start + batchSize),
    });
  }
  for (let start = 0; start < images.length; start += batchSize) {
    await client.vehicleImage.createMany({
      data: images.slice(start, start + batchSize),
    });
  }

  return {
    vehicleCount: total,
    brandCount: brands.length,
    usableDetailSlug: firstUsableSlug ?? vehicles[0]!.slug,
  };
}
