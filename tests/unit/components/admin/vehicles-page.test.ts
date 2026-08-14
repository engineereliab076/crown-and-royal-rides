import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vehicle admin components", () => {
  it("submits only the allow-listed create fields", () => {
    const source = readFileSync(
      "src/components/admin/vehicle-create-form.tsx",
      "utf8",
    );
    const payload = source.slice(
      source.indexOf("const payload ="),
      source.indexOf("try {", source.indexOf("const payload =")),
    );
    for (const field of [
      "brandId",
      "model",
      "year",
      "bodyType",
      "condition",
      "transmission",
      "fuelType",
      "driverOption",
      "isForSale",
      "saleStatus",
      "salePrice",
      "description",
    ])
      expect(payload).toContain(field);
    for (const forbidden of [
      "brandName",
      "slug",
      "listingState",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "images",
    ])
      expect(payload).not.toContain(forbidden);
  });

  it("renders safe publication requirements and a no-brand empty state", () => {
    const publishSource = readFileSync(
      "src/components/admin/vehicle-publish-button.tsx",
      "utf8",
    );
    const newPageSource = readFileSync(
      "src/app/admin/(protected)/vehicles/new/page.tsx",
      "utf8",
    );
    expect(publishSource).toContain("coverImage");
    expect(publishSource).toContain('role="alert"');
    expect(newPageSource).toMatch(
      /No brands are available\. Add foundation brand data before creating a\s+vehicle\./,
    );
  });

  it("uses the multi-file gallery flow without browser persistence or provider SDKs", () => {
    const source = readFileSync(
      "src/components/admin/vehicle-gallery-manager.tsx",
      "utf8",
    );
    // Compression happens before any authorization/upload.
    expect(source).toContain("compressVehicleImage");
    expect(source).toContain("/api/admin/media/signature");
    expect(source).toContain("uploadToProvider");
    // A single batch reorder PATCH, not one request per image.
    expect(source).toContain("/images/reorder");
    // Object URLs are revoked (no leaks).
    expect(source).toContain("URL.revokeObjectURL");
    // No browser persistence of authorization, no logging, no provider SDK.
    expect(source).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|console\./,
    );
    expect(source).not.toMatch(/from ["']cloudinary/);
  });

  it("renders the gallery manager on the vehicle detail page", () => {
    const source = readFileSync(
      "src/app/admin/(protected)/vehicles/[id]/page.tsx",
      "utf8",
    );
    expect(source).toContain("<VehicleGalleryManager");
    expect(source).toContain("initialGallery={gallery}");
    // The single-cover `unoptimized` <Image> is gone from this page.
    expect(source).not.toContain("unoptimized");
  });
});
