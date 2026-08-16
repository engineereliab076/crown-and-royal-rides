import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { parseVehicleFilters, type VehicleMode } from "@/lib/vehicle-filters";
import { createPrismaPublicVehicleRepository } from "@/server/modules/vehicles/public-repository";
import { createPublicVehicleService } from "@/server/modules/vehicles/public-service";
import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Phase 7, Group 1 — real-PostgreSQL correctness for URL-driven search,
 * filters, sorting, facets, and 24-per-page pagination. Exercises the raw-SQL
 * search path, the hydration/reorder step, and the facet queries end to end.
 */

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

function service() {
  return createPublicVehicleService({
    repository: createPrismaPublicVehicleRepository(client()),
  });
}

/** Run a raw URL query string through the parser and the catalogue service. */
async function search(
  mode: VehicleMode,
  params: Record<string, string | string[] | undefined>,
) {
  const parsed = parseVehicleFilters(params, mode);
  const result = await service().executeCatalogueSearch({
    mode: parsed.mode,
    filters: parsed.filters,
    sort: parsed.sort,
    page: parsed.page,
  });
  return { parsed, result };
}

async function makeBrand(name: string, slug: string) {
  return client().brand.create({
    data: { name, slug, sortOrder: 1 },
    select: { id: true, name: true, slug: true },
  });
}

interface VehicleSpec {
  readonly slug: string;
  readonly brandId: string;
  readonly brandName: string;
  readonly model?: string;
  readonly year?: number;
  readonly bodyType?: "sedan" | "suv" | "pickup" | "coupe";
  readonly condition?: "brand_new" | "foreign_used" | "locally_used";
  readonly transmission?: "automatic" | "manual";
  readonly fuelType?: "petrol" | "diesel" | "hybrid" | "electric";
  readonly driverOption?: "with_driver" | "without_driver";
  readonly drivetrain?: "fwd" | "rwd" | "awd" | "four_wd" | null;
  readonly listingState?: "draft" | "published" | "archived";
  readonly isForSale?: boolean;
  readonly saleStatus?: "available" | "reserved" | "sold";
  readonly salePrice?: bigint;
  readonly isForRent?: boolean;
  readonly rentalStatus?: "available" | "reserved" | "rented" | "unavailable";
  readonly rentalDailyPrice?: bigint;
  readonly minRentalDays?: number;
  readonly description?: string;
  readonly publishedAt?: Date;
}

async function makeVehicle(spec: VehicleSpec) {
  const listingState = spec.listingState ?? "published";
  const isForSale = spec.isForSale ?? true;
  const isForRent = spec.isForRent ?? false;
  return client().vehicle.create({
    data: {
      brandId: spec.brandId,
      brandName: spec.brandName,
      model: spec.model ?? "Model",
      slug: spec.slug,
      year: spec.year ?? 2018,
      bodyType: spec.bodyType ?? "suv",
      condition: spec.condition ?? "foreign_used",
      transmission: spec.transmission ?? "automatic",
      fuelType: spec.fuelType ?? "diesel",
      driverOption: spec.driverOption ?? "without_driver",
      drivetrain: spec.drivetrain === undefined ? "awd" : spec.drivetrain,
      listingState,
      publishedAt:
        listingState === "published"
          ? (spec.publishedAt ?? new Date("2026-08-01T00:00:00.000Z"))
          : null,
      isForSale,
      saleStatus: isForSale ? (spec.saleStatus ?? "available") : null,
      salePrice: isForSale ? (spec.salePrice ?? BigInt(40_000_000)) : null,
      isForRent,
      rentalStatus: isForRent ? (spec.rentalStatus ?? "available") : null,
      rentalDailyPrice: isForRent
        ? (spec.rentalDailyPrice ?? BigInt(150_000))
        : null,
      minRentalDays: isForRent ? (spec.minRentalDays ?? 2) : null,
      description: spec.description ?? null,
    },
    select: { id: true, slug: true },
  });
}

function slugs(items: readonly { slug: string }[]): string[] {
  return items.map((item) => item.slug).sort();
}

describe("catalogue search — filters against PostgreSQL", () => {
  it("applies each categorical filter independently and reports invalid ones without rejecting", async () => {
    const toyota = await makeBrand("Toyota", "toyota");
    const bmw = await makeBrand("BMW", "bmw");
    await makeVehicle({
      slug: "toyota-suv-auto-diesel",
      brandId: toyota.id,
      brandName: "Toyota",
      bodyType: "suv",
      transmission: "automatic",
      fuelType: "diesel",
      condition: "foreign_used",
      drivetrain: "awd",
      driverOption: "without_driver",
    });
    await makeVehicle({
      slug: "toyota-sedan-manual-petrol",
      brandId: toyota.id,
      brandName: "Toyota",
      bodyType: "sedan",
      transmission: "manual",
      fuelType: "petrol",
      condition: "locally_used",
      drivetrain: "fwd",
      driverOption: "with_driver",
    });
    await makeVehicle({
      slug: "bmw-coupe-auto-hybrid",
      brandId: bmw.id,
      brandName: "BMW",
      bodyType: "coupe",
      transmission: "automatic",
      fuelType: "hybrid",
      condition: "brand_new",
      drivetrain: null,
      driverOption: "without_driver",
    });

    expect(slugs((await search("all", { brand: "toyota" })).result.items)).toEqual(
      ["toyota-sedan-manual-petrol", "toyota-suv-auto-diesel"],
    );
    expect(
      slugs((await search("all", { bodyType: "sedan" })).result.items),
    ).toEqual(["toyota-sedan-manual-petrol"]);
    expect(
      slugs((await search("all", { transmission: "manual" })).result.items),
    ).toEqual(["toyota-sedan-manual-petrol"]);
    expect(
      slugs((await search("all", { fuelType: "hybrid" })).result.items),
    ).toEqual(["bmw-coupe-auto-hybrid"]);
    expect(
      slugs((await search("all", { condition: "brand_new" })).result.items),
    ).toEqual(["bmw-coupe-auto-hybrid"]);
    expect(
      slugs((await search("all", { drivetrain: "fwd" })).result.items),
    ).toEqual(["toyota-sedan-manual-petrol"]);
    expect(
      slugs((await search("all", { driverOption: "with_driver" })).result.items),
    ).toEqual(["toyota-sedan-manual-petrol"]);

    // A combination narrows further.
    expect(
      slugs(
        (await search("all", { brand: "toyota", bodyType: "suv" })).result
          .items,
      ),
    ).toEqual(["toyota-suv-auto-diesel"]);

    // An invalid value is ignored (all three returned) and reported.
    const invalid = await search("all", { bodyType: "spaceship" });
    expect(invalid.result.items).toHaveLength(3);
    expect(invalid.parsed.ignoredFilters).toContainEqual({
      key: "bodyType",
      reason: "invalid_enum",
    });
  });

  it("filters by stable brand slug and is unaffected by a brand rename", async () => {
    const toyota = await makeBrand("Toyota", "toyota");
    await makeVehicle({
      slug: "toyota-one",
      brandId: toyota.id,
      brandName: "Toyota",
    });
    expect(
      slugs((await search("all", { brand: "toyota" })).result.items),
    ).toEqual(["toyota-one"]);

    // Rename the brand display name (propagated to the denormalized column);
    // the slug — and therefore the filter URL — is unchanged.
    await client().brand.update({
      where: { id: toyota.id },
      data: { name: "Toyota Motors" },
    });
    await client().vehicle.updateMany({
      where: { brandId: toyota.id },
      data: { brandName: "Toyota Motors" },
    });
    expect(
      slugs((await search("all", { brand: "toyota" })).result.items),
    ).toEqual(["toyota-one"]);
    const facets = (await search("all", {})).result.facets;
    expect(facets.brand).toContainEqual({
      value: "toyota",
      label: "Toyota Motors",
      count: 1,
    });
  });

  it("applies year bounds inclusively with swap", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    for (const year of [2005, 2015, 2020]) {
      await makeVehicle({
        slug: `year-${year}`,
        brandId: brand.id,
        brandName: "Toyota",
        year,
      });
    }
    expect(
      slugs(
        (await search("all", { yearMin: "2015", yearMax: "2020" })).result
          .items,
      ),
    ).toEqual(["year-2015", "year-2020"]);
    // Inverted bounds are swapped, not rejected.
    expect(
      slugs(
        (await search("all", { yearMin: "2020", yearMax: "2015" })).result
          .items,
      ),
    ).toEqual(["year-2015", "year-2020"]);
  });
});

describe("catalogue search — mode-aware price semantics", () => {
  it("filters and sorts sale price on the sale column only", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    await makeVehicle({
      slug: "sale-cheap",
      brandId: brand.id,
      brandName: "Toyota",
      salePrice: BigInt(20_000_000),
    });
    await makeVehicle({
      slug: "sale-dear",
      brandId: brand.id,
      brandName: "Toyota",
      salePrice: BigInt(90_000_000),
    });

    const filtered = await search("sale", {
      priceMin: "25000000",
      priceMax: "100000000",
    });
    expect(slugs(filtered.result.items)).toEqual(["sale-dear"]);

    const asc = await search("sale", { sort: "price_asc" });
    expect(asc.result.items.map((v) => v.slug)).toEqual([
      "sale-cheap",
      "sale-dear",
    ]);
    const desc = await search("sale", { sort: "price_desc" });
    expect(desc.result.items.map((v) => v.slug)).toEqual([
      "sale-dear",
      "sale-cheap",
    ]);
  });

  it("filters rental price on the rental column and exposes a rental price range", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    await makeVehicle({
      slug: "rent-low",
      brandId: brand.id,
      brandName: "Toyota",
      isForSale: false,
      isForRent: true,
      rentalDailyPrice: BigInt(100_000),
    });
    await makeVehicle({
      slug: "rent-high",
      brandId: brand.id,
      brandName: "Toyota",
      isForSale: false,
      isForRent: true,
      rentalDailyPrice: BigInt(400_000),
    });
    const filtered = await search("rental", { priceMin: "200000" });
    expect(slugs(filtered.result.items)).toEqual(["rent-high"]);
    expect(filtered.result.facets.price).toEqual({ min: 100_000, max: 400_000 });
  });

  it("ignores price parameters and price sort in all mode", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    await makeVehicle({ slug: "a", brandId: brand.id, brandName: "Toyota" });
    const { parsed, result } = await search("all", {
      priceMin: "1000",
      sort: "price_asc",
    });
    expect(result.items).toHaveLength(1);
    expect(result.sort).toBe("newest");
    expect(result.facets.price).toBeNull();
    expect(parsed.ignoredFilters).toContainEqual({
      key: "priceMin",
      reason: "not_applicable",
    });
    expect(parsed.ignoredFilters).toContainEqual({
      key: "sort",
      reason: "price_sort_not_supported",
    });
  });
});

describe("catalogue search — full-text and trigram", () => {
  async function seedSearchCorpus() {
    const toyota = await makeBrand("Toyota", "toyota");
    const bmw = await makeBrand("BMW", "bmw");
    await makeVehicle({
      slug: "toyota-corolla",
      brandId: toyota.id,
      brandName: "Toyota",
      model: "Corolla",
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    await makeVehicle({
      slug: "toyota-camry",
      brandId: toyota.id,
      brandName: "Toyota",
      model: "Camry",
      publishedAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    await makeVehicle({
      slug: "bmw-x5",
      brandId: bmw.id,
      brandName: "BMW",
      model: "X5",
      publishedAt: new Date("2026-08-03T00:00:00.000Z"),
    });
    return { toyota, bmw };
  }

  it("matches an exact term via full-text", async () => {
    await seedSearchCorpus();
    const result = await search("all", { q: "corolla" });
    expect(slugs(result.result.items)).toEqual(["toyota-corolla"]);
  });

  it("tolerates a typo via trigram similarity", async () => {
    await seedSearchCorpus();
    const result = await search("all", { q: "corola" });
    expect(result.result.items.map((v) => v.slug)).toContain("toyota-corolla");
  });

  it("ranks relevance deterministically and keeps a stable id tie-break", async () => {
    const { toyota } = await seedSearchCorpus();
    // Two equally-relevant rows for the query term; ranking ties break by id ASC.
    const a = await makeVehicle({
      slug: "toyota-corolla-twin-a",
      brandId: toyota.id,
      brandName: "Toyota",
      model: "Corolla",
    });
    const b = await makeVehicle({
      slug: "toyota-corolla-twin-b",
      brandId: toyota.id,
      brandName: "Toyota",
      model: "Corolla",
    });
    const result = await search("all", { q: "corolla", sort: "relevance" });
    const ids = result.result.items.map((v) => v.id);
    const twinIds = [a.id, b.id].sort();
    const seenTwins = ids.filter((id) => twinIds.includes(id));
    expect(seenTwins).toEqual(twinIds); // ascending id order preserved
  });
});

describe("catalogue search — exclusions, reserved, pagination, DTO safety", () => {
  it("excludes draft, archived, and unusable rows; keeps reserved visible and non-actionable", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    await makeVehicle({ slug: "usable", brandId: brand.id, brandName: "Toyota" });
    await makeVehicle({
      slug: "draft",
      brandId: brand.id,
      brandName: "Toyota",
      listingState: "draft",
    });
    await makeVehicle({
      slug: "archived",
      brandId: brand.id,
      brandName: "Toyota",
      listingState: "archived",
    });
    await makeVehicle({
      slug: "sold-only",
      brandId: brand.id,
      brandName: "Toyota",
      saleStatus: "sold",
    });
    await makeVehicle({
      slug: "reserved",
      brandId: brand.id,
      brandName: "Toyota",
      saleStatus: "reserved",
    });

    const result = await search("all", {});
    expect(slugs(result.result.items)).toEqual(["reserved", "usable"]);
    const reserved = result.result.items.find((v) => v.slug === "reserved");
    expect(reserved?.presentation.badge).toBe("reserved");
    expect(reserved?.presentation.saleActionable).toBe(false);
    expect(reserved?.presentation.showSalePrice).toBe(true);
    expect(reserved?.presentation.indexable).toBe(true);
  });

  it("paginates a filtered set at 24 with no duplicates or gaps", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    const publishedAt = new Date("2026-08-05T00:00:00.000Z");
    for (let index = 0; index < 30; index += 1) {
      await makeVehicle({
        slug: `suv-${index.toString().padStart(2, "0")}`,
        brandId: brand.id,
        brandName: "Toyota",
        bodyType: "suv",
        publishedAt,
      });
    }
    const first = await search("all", { bodyType: "suv" });
    const second = await search("all", { bodyType: "suv", page: "2" });
    expect(first.result.items).toHaveLength(24);
    expect(second.result.items).toHaveLength(6);
    expect(first.result.pageSize).toBe(24);
    expect(first.result.totalItems).toBe(30);
    expect(first.result.totalPages).toBe(2);
    const all = [...first.result.items, ...second.result.items].map((v) => v.id);
    expect(new Set(all).size).toBe(30);
  });

  it("never leaks private fields through the search result", async () => {
    const brand = await makeBrand("Toyota", "toyota");
    await client().vehicle.create({
      data: {
        brandId: brand.id,
        brandName: "Toyota",
        model: "Secret",
        slug: "private-fields",
        year: 2020,
        bodyType: "suv",
        condition: "foreign_used",
        transmission: "automatic",
        fuelType: "diesel",
        driverOption: "without_driver",
        drivetrain: "awd",
        listingState: "published",
        publishedAt: new Date("2026-08-01T00:00:00.000Z"),
        isForSale: true,
        saleStatus: "available",
        salePrice: BigInt(50_000_000),
        registrationNumber: "SEARCH-PRIVATE-REG",
        chassisNumber: "SEARCH-PRIVATE-CHASSIS",
      },
    });
    const result = await search("all", {});
    const serialized = JSON.stringify(result.result);
    for (const forbidden of [
      "registrationNumber",
      "chassisNumber",
      "SEARCH-PRIVATE-REG",
      "SEARCH-PRIVATE-CHASSIS",
      "searchVector",
      "searchText",
      "brandId",
      "listingState",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("catalogue facets — counts and self-exclusion", () => {
  it("counts categorical facets with self-exclusion and stable numeric ranges", async () => {
    const toyota = await makeBrand("Toyota", "toyota");
    const bmw = await makeBrand("BMW", "bmw");
    // 3 SUVs, 2 sedans; brand mix; varied years.
    await makeVehicle({ slug: "suv-1", brandId: toyota.id, brandName: "Toyota", bodyType: "suv", year: 2010 });
    await makeVehicle({ slug: "suv-2", brandId: toyota.id, brandName: "Toyota", bodyType: "suv", year: 2015 });
    await makeVehicle({ slug: "suv-3", brandId: bmw.id, brandName: "BMW", bodyType: "suv", year: 2020 });
    await makeVehicle({ slug: "sedan-1", brandId: toyota.id, brandName: "Toyota", bodyType: "sedan", year: 2012 });
    await makeVehicle({ slug: "sedan-2", brandId: bmw.id, brandName: "BMW", bodyType: "sedan", year: 2018 });

    // With bodyType=suv selected, the bodyType facet is self-excluded, so it
    // still reports both body types; every other facet reflects only SUVs.
    const { result } = await search("all", { bodyType: "suv" });
    const body = new Map(result.facets.bodyType.map((o) => [o.value, o.count]));
    expect(body.get("suv")).toBe(3);
    expect(body.get("sedan")).toBe(2);

    // The brand facet respects the active bodyType=suv filter (self-excludes
    // only its own dimension): 2 Toyota SUVs, 1 BMW SUV.
    const brandCounts = new Map(
      result.facets.brand.map((o) => [o.value, o.count]),
    );
    expect(brandCounts.get("toyota")).toBe(2);
    expect(brandCounts.get("bmw")).toBe(1);

    // Numeric year range is mode-wide and stable (not filter-aware): full span.
    expect(result.facets.year).toEqual({ min: 2010, max: 2020 });
  });

  it("keeps the search term applied to every facet query", async () => {
    const toyota = await makeBrand("Toyota", "toyota");
    const bmw = await makeBrand("BMW", "bmw");
    await makeVehicle({ slug: "toyota-corolla", brandId: toyota.id, brandName: "Toyota", model: "Corolla", bodyType: "sedan" });
    await makeVehicle({ slug: "bmw-x5", brandId: bmw.id, brandName: "BMW", model: "X5", bodyType: "suv" });

    const { result } = await search("all", { q: "corolla" });
    // Only the Corolla matches, so facets reflect just that row.
    expect(result.facets.brand).toEqual([
      { value: "toyota", label: "Toyota", count: 1 },
    ]);
    expect(result.facets.bodyType).toEqual([{ value: "sedan", count: 1 }]);
  });
});
