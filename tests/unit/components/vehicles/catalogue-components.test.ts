import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level guarantees for the reusable public catalogue components,
 * mirroring the repository's component-source-scan convention (interactive DOM
 * behavior is verified end-to-end by Playwright in Group 2).
 */

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("VehicleCard", () => {
  const source = read("src/components/vehicles/vehicle-card.tsx");

  it("is a semantic linked article with a single interactive control", () => {
    expect(source).toContain("<article");
    expect(source).toContain("<Link");
    // No nested interactive control inside the card link.
    expect(source).not.toContain("<button");
  });

  it("renders the cover through the global Cloudinary loader with responsive sizes and alt", () => {
    // The Server Component relies on the global `images.loaderFile` rather than
    // passing the loader function across the server→client boundary.
    expect(source).toContain("<Image");
    expect(source).toContain("src={cover.url}");
    expect(source).not.toContain("loader={cloudinaryLoader}");
    expect(source).toContain("sizes={CARD_IMAGE_SIZES}");
    expect(source).toContain("alt={cover.altText}");
    expect(source).not.toContain("unoptimized");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("meets the 44px touch target and shows a keyboard focus ring", () => {
    expect(source).toContain("min-h-11");
    expect(source).toContain("focus-visible:ring");
  });

  it("delegates status and price to the centralized components", () => {
    expect(source).toContain("VehicleStatusBadge");
    expect(source).toContain("PriceDisplay");
  });

  it("never imports Prisma or a repository/service", () => {
    expect(source).not.toMatch(/generated\/prisma|server\/db\/prisma/);
    expect(source).not.toMatch(/public-repository|public-service/);
  });
});

describe("VehicleStatusBadge", () => {
  const source = read("src/components/vehicles/vehicle-status-badge.tsx");

  it("consumes only the centralized presentation state's badge", () => {
    expect(source).toContain("presentation.badge");
    // It must not re-derive business rules itself.
    expect(source).not.toContain("resolveVehiclePublicState");
  });

  it("maps every badge value with a text label and an icon (not color-only)", () => {
    for (const badge of [
      "for-sale",
      "for-rent",
      "for-sale-and-rent",
      "reserved",
      "sold",
      "retired",
      "unavailable",
    ]) {
      expect(source).toContain(badge);
    }
    expect(source).toContain("label:");
    expect(source).toContain("icon:");
    expect(source).toContain("{style.label}");
  });
});

describe("PriceDisplay", () => {
  const source = read("src/components/vehicles/price-display.tsx");

  it("formats money with formatTzs", () => {
    expect(source).toContain("formatTzs");
  });

  it("only shows prices the presentation state marks displayable", () => {
    expect(source).toContain("presentation.showSalePrice");
    expect(source).toContain("presentation.showRentalPrice");
    expect(source).toContain("return null");
  });

  it("clearly labels daily rental pricing and the minimum days", () => {
    expect(source).toContain("/ day");
    expect(source).toContain("Minimum");
  });
});

describe("VehicleSpecTable", () => {
  const source = read("src/components/vehicles/vehicle-spec-table.tsx");

  it("uses a semantic description list", () => {
    expect(source).toContain("<dl");
    expect(source).toContain("<dt");
    expect(source).toContain("<dd");
  });

  it("renders the approved public specification surface", () => {
    for (const label of [
      "Body type",
      "Condition",
      "Transmission",
      "Fuel type",
      "Drivetrain",
      "Mileage",
      "Engine",
      "Seats",
      "Doors",
      "Exterior colour",
      "Interior colour",
      "Location",
      "Driver arrangement",
      "Driver note",
    ]) {
      expect(source).toContain(label);
    }
  });

  it("never renders private registration or chassis identifiers", () => {
    expect(source).not.toContain("registrationNumber");
    expect(source).not.toContain("chassisNumber");
  });
});

describe("VehicleGrid", () => {
  const source = read("src/components/vehicles/vehicle-grid.tsx");

  it("is a responsive grid that accepts already-mapped DTOs", () => {
    expect(source).toContain("grid-cols-1");
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain("lg:grid-cols-3");
  });

  it("renders the accessible shared empty state when there are no vehicles", () => {
    expect(source).toContain("vehicles.length === 0");
    expect(source).toContain("CatalogueEmptyState");
  });

  it("imports no repository or service", () => {
    expect(source).not.toMatch(
      /public-repository|public-service|server\/db\/prisma/,
    );
  });
});

describe("shared empty state and pagination", () => {
  it("empty state is an accessible status region", () => {
    const source = read("src/components/vehicles/catalogue-empty-state.tsx");
    expect(source).toContain('role="status"');
  });

  it("pagination emits page-only URLs and meets the touch target", () => {
    const source = read("src/components/vehicles/catalogue-pagination.tsx");
    // The only URL template is page-only: no query concatenation, no filters.
    expect(source).toContain("`${basePath}?page=${page}`");
    expect(source).not.toMatch(/\?page=[^`"']*&/);
    expect(source).not.toMatch(/search=|filter=|sort=/);
    expect(source).toContain("h-11");
    expect(source).toContain('aria-label="Catalogue pagination"');
  });
});
