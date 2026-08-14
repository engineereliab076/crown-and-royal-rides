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

  it("renders the verified cover through next/image with trusted dimensions", () => {
    expect(source).toContain('import Image from "next/image"');
    expect(source).toContain("width={vehicle.coverImage.width}");
    expect(source).toContain("height={vehicle.coverImage.height}");
    expect(source).toContain("unoptimized");
    expect(source).toContain('sizes="(min-width: 1280px)');
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
