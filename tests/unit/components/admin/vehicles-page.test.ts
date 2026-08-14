import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  "src/components/admin/vehicle-form-workflow.tsx",
  "utf8",
);
const detail = readFileSync(
  "src/components/admin/vehicle-detail-client.tsx",
  "utf8",
);
const list = readFileSync(
  "src/components/admin/vehicle-list-client.tsx",
  "utf8",
);
const brand = readFileSync(
  "src/components/admin/brand-management-client.tsx",
  "utf8",
);

describe("Phase 5 vehicle administration UI contracts", () => {
  it("creates a draft only before an ID exists and replaces the URL with the real edit route", () => {
    expect(workflow).toContain("if (vehicle === null)");
    expect(workflow).toContain('fetch("/api/admin/vehicles"');
    expect(workflow).toContain("router.replace(stepHref(saved.id, 2))");
    expect(workflow).not.toMatch(/localStorage|sessionStorage|console\./);
  });

  it("persists step payloads, preserves local inputs on errors, and routes status changes through transition", () => {
    expect(workflow).toContain('step: "modes-and-pricing"');
    expect(workflow).toContain('step: "driver-arrangement"');
    expect(workflow).toContain('step: "specifications"');
    expect(workflow).toContain('step: "description-and-features"');
    expect(workflow).toContain("for (const action of plan.transitions)");
    expect(workflow).toContain("setError(message)");
    expect(workflow).not.toContain("setDraft(initialState");
  });

  it("uses the canonical gallery, server checklist, legacy warning, and guarded publish transition", () => {
    expect(workflow).toContain("<VehicleGalleryManager");
    expect(workflow).toContain("onGalleryChanged={refreshVehicle}");
    expect(workflow).toContain("vehicle.publicationReadiness.checklist");
    expect(workflow).toContain("REQUIREMENT_STEP[item.key]");
    expect(workflow).toContain("This legacy published vehicle is missing");
    expect(workflow).toContain('transition(vehicle.id, "publish")');
    expect(workflow).toContain("!vehicle.publicationReadiness.ready");
  });

  it("keeps private identifiers in an explicitly admin-only review and out of browser persistence", () => {
    expect(workflow).toContain("Private · administrators only");
    expect(workflow).toContain("vehicle.registrationNumber");
    expect(workflow).toContain("vehicle.chassisNumber");
    expect(workflow).not.toMatch(/localStorage|sessionStorage|console\./);
  });

  it("maps every detail action to the dedicated transition, featured, or verification endpoint", () => {
    expect(detail).toContain("/transition");
    expect(detail).toContain("/featured");
    expect(detail).toContain("/verify");
    for (const action of [
      "publish",
      "unpublish",
      "archive",
      "restore",
      "sale_",
      "rental_",
    ]) {
      expect(detail).toContain(action);
    }
    expect(detail).not.toContain('method: "PATCH"');
    expect(detail).toContain("DANGEROUS");
  });

  it("uses server badges and dedicated list actions without private filters", () => {
    expect(list).toContain("pretty(vehicle.badge)");
    expect(list).toContain("/verify");
    expect(list).toContain("/featured");
    expect(list).toContain("of 8 vehicles featured");
    expect(list).not.toMatch(/registrationNumber|chassisNumber/);
  });

  it("uses one brand update request and surfaces deletion conflicts without partial claims", () => {
    expect(brand).toContain('method: "PATCH"');
    expect(brand).toContain('method: "DELETE"');
    expect(brand).toContain(
      "Brand updated. Vehicle brand snapshots were refreshed",
    );
    expect(brand).toContain("Brands used by vehicles must be retained");
    expect(brand).not.toContain("/api/admin/vehicles");
  });

  it("renders the workflow/detail clients from protected server pages", () => {
    const newPage = readFileSync(
      "src/app/admin/(protected)/vehicles/new/page.tsx",
      "utf8",
    );
    const editPage = readFileSync(
      "src/app/admin/(protected)/vehicles/[id]/edit/page.tsx",
      "utf8",
    );
    const detailPage = readFileSync(
      "src/app/admin/(protected)/vehicles/[id]/page.tsx",
      "utf8",
    );
    expect(newPage).toContain("<VehicleFormWorkflow");
    expect(newPage).toContain('href="/admin/brands"');
    expect(editPage).toContain("<VehicleFormWorkflow");
    expect(detailPage).toContain("<VehicleDetailClient");
    expect(detail).toContain("<VehicleGalleryManager");
  });
});
