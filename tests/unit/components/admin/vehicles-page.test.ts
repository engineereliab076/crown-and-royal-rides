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

  it("uses the single-file cover flow without browser persistence or provider SDKs", () => {
    const source = readFileSync(
      "src/components/admin/vehicle-cover-uploader.tsx",
      "utf8",
    );
    expect(source).toContain("accept={VEHICLE_COVER_ACCEPT}");
    expect(source).toContain("/api/admin/media/signature");
    expect(source).toContain("authorization.uploadUrl");
    expect(source).toContain(`/cover`);
    expect(source).toContain("if (file === null || busy) return");
    expect(source).toContain("clearFile()");
    expect(source).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|console\./,
    );
    expect(source).not.toMatch(/from ["']cloudinary/);
  });

  it("hides the uploader once an admin cover exists", () => {
    const source = readFileSync(
      "src/app/admin/(protected)/vehicles/[id]/page.tsx",
      "utf8",
    );
    expect(source).toMatch(
      /vehicle\.coverImage[\s\S]*<Image[\s\S]*:[\s\S]*<VehicleCoverUploader/,
    );
    expect(source).toContain("width={vehicle.coverImage.width}");
    expect(source).toContain("height={vehicle.coverImage.height}");
    expect(source).toContain("unoptimized");
  });
});
