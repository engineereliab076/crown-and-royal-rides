import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public vehicle page boundaries", () => {
  const source = readFileSync("src/app/cars/[slug]/page.tsx", "utf8");

  it("loads through the public vehicle service and stable tagged cache", () => {
    expect(source).toContain("getPublicVehicleService().getPublicBySlug(slug)");
    expect(source).toContain("getCachedPublicVehicle");
    expect(source).toContain("export const revalidate = 300");
  });

  it("maps safe not-found errors to Next.js notFound", () => {
    expect(source).toContain("error.status === 404");
    expect(source).toContain("notFound()");
  });

  it("renders the responsive gallery instead of a single unoptimized cover", () => {
    // Phase 4: the public page delegates to the accessible gallery component,
    // which uses next/image through the Cloudinary loader (no `unoptimized`).
    expect(source).toContain("<VehicleGallery");
    expect(source).toContain("images={vehicle.images}");
    expect(source).not.toContain("unoptimized");
    expect(source).not.toContain('import Image from "next/image"');
  });

  it("never imports Prisma, provider SDKs, or renders forbidden metadata", () => {
    expect(source).not.toMatch(/generated\/prisma|server\/db\/prisma/);
    expect(source).not.toMatch(/from ["']cloudinary/);
    for (const forbidden of [
      "registrationNumber",
      "chassisNumber",
      "publicId",
      "signature",
      "apiKey",
      "searchVector",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
