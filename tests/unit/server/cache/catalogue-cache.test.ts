import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  unstableCalls: [] as { keyParts: unknown; options: unknown }[],
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    load: () => unknown,
    keyParts: unknown,
    options: unknown,
  ) => {
    hoisted.unstableCalls.push({ keyParts, options });
    return load;
  },
  revalidateTag: (tag: string) => {
    hoisted.revalidated.push(tag);
  },
}));

import {
  getCachedActiveCatalogue,
  getCachedFeatured,
  getCachedPublicVehicleDetail,
  getCachedRentalCatalogue,
  getCachedSaleCatalogue,
  revalidateCatalogue,
  revalidatePublicVehicle,
  revalidateVehicle,
  vehicleCacheTag,
  VEHICLE_CATALOGUE_TAG,
  VEHICLE_FEATURED_TAG,
  VEHICLE_RENTAL_TAG,
  VEHICLE_SALE_TAG,
} from "@/server/cache/vehicles";

describe("catalogue cache tags", () => {
  it("exposes stable, distinct tag identifiers", () => {
    expect(vehicleCacheTag("abc")).toBe("vehicle:abc");
    const tags = new Set([
      VEHICLE_CATALOGUE_TAG,
      VEHICLE_SALE_TAG,
      VEHICLE_RENTAL_TAG,
      VEHICLE_FEATURED_TAG,
    ]);
    expect(tags.size).toBe(4);
  });
});

describe("parameterized catalogue caches never share keys across pages/slugs", () => {
  it("keys the active catalogue by page and tags it catalogue-wide", async () => {
    hoisted.unstableCalls.length = 0;
    await getCachedActiveCatalogue(2, async () => ({}) as never);
    await getCachedActiveCatalogue(3, async () => ({}) as never);
    const [first, second] = hoisted.unstableCalls;
    expect(first?.keyParts).toEqual(["public-catalogue-active", "2"]);
    expect(second?.keyParts).toEqual(["public-catalogue-active", "3"]);
    expect((first?.options as { tags: string[] }).tags).toContain(
      VEHICLE_CATALOGUE_TAG,
    );
  });

  it("keys sale and rental catalogues under their own tags", async () => {
    hoisted.unstableCalls.length = 0;
    await getCachedSaleCatalogue(1, async () => ({}) as never);
    await getCachedRentalCatalogue(1, async () => ({}) as never);
    expect(
      (hoisted.unstableCalls[0]?.options as { tags: string[] }).tags,
    ).toEqual([VEHICLE_SALE_TAG]);
    expect(
      (hoisted.unstableCalls[1]?.options as { tags: string[] }).tags,
    ).toEqual([VEHICLE_RENTAL_TAG]);
  });

  it("keys the detail by slug and tags it per-slug plus catalogue-wide", async () => {
    hoisted.unstableCalls.length = 0;
    await getCachedPublicVehicleDetail("toyota-x", async () => ({}) as never);
    const call = hoisted.unstableCalls[0];
    expect(call?.keyParts).toEqual(["public-vehicle-detail", "toyota-x"]);
    expect((call?.options as { tags: string[] }).tags).toEqual([
      vehicleCacheTag("toyota-x"),
      VEHICLE_CATALOGUE_TAG,
    ]);
  });

  it("tags the featured rail with the featured tag", async () => {
    hoisted.unstableCalls.length = 0;
    await getCachedFeatured(async () => []);
    expect(
      (hoisted.unstableCalls[0]?.options as { tags: string[] }).tags,
    ).toEqual([VEHICLE_FEATURED_TAG]);
  });
});

describe("catalogue revalidation targets", () => {
  it("revalidateVehicle targets only the per-slug tag", () => {
    hoisted.revalidated.length = 0;
    revalidateVehicle("toyota-x");
    expect(hoisted.revalidated).toEqual([vehicleCacheTag("toyota-x")]);
  });

  it("revalidateCatalogue targets every catalogue-scoped tag", () => {
    hoisted.revalidated.length = 0;
    revalidateCatalogue();
    expect(hoisted.revalidated).toEqual([
      VEHICLE_CATALOGUE_TAG,
      VEHICLE_SALE_TAG,
      VEHICLE_RENTAL_TAG,
      VEHICLE_FEATURED_TAG,
    ]);
  });

  it("revalidatePublicVehicle targets the slug plus every catalogue tag", () => {
    hoisted.revalidated.length = 0;
    revalidatePublicVehicle("toyota-x");
    expect(hoisted.revalidated).toEqual([
      vehicleCacheTag("toyota-x"),
      VEHICLE_CATALOGUE_TAG,
      VEHICLE_SALE_TAG,
      VEHICLE_RENTAL_TAG,
      VEHICLE_FEATURED_TAG,
    ]);
  });
});
