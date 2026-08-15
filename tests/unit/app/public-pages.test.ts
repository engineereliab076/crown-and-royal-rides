import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Phase 6 public page boundaries", () => {
  it("keeps public data request-rendered and tagged-cache backed", () => {
    const layout = read("src/app/(public)/layout.tsx");
    const cache = read("src/server/cache/vehicles.ts");
    expect(layout).toContain('dynamic = "force-dynamic"');
    expect(cache).toContain("unstable_cache");
    expect(cache).toContain("VEHICLE_REVALIDATE_SECONDS = 300");
  });

  it("uses only the shared pagination parameter on catalogue pages", () => {
    for (const route of ["cars", "cars-for-sale", "cars-for-rent"]) {
      const source = read(`src/app/(public)/${route}/page.tsx`);
      expect(source).toContain("normalizePageParam((await searchParams).page)");
      expect(source).not.toContain("<form");
      expect(source).not.toMatch(/server\/db\/prisma|generated\/prisma/);
    }
  });

  it("keeps rental and reserved details out of the purchase form", () => {
    const source = read("src/app/(public)/cars/[slug]/page.tsx");
    expect(source).toContain("presentation.saleActionable ?");
    expect(source).toContain("presentation.rentalActionable ?");
    expect(source).toContain(
      "!presentation.saleActionable && !presentation.rentalActionable",
    );
    expect(source).toContain("<StickyMobileActions");
  });

  it("does not expose private vehicle identifiers from public composition", () => {
    const source = [
      read("src/app/(public)/cars/[slug]/page.tsx"),
      read("src/components/vehicles/vehicle-spec-table.tsx"),
    ].join("\n");
    expect(source).not.toMatch(/registrationNumber|chassisNumber|searchVector/);
  });
});
