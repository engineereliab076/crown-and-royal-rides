import { describe, expect, it } from "vitest";

import {
  addFeature,
  buildVehicleModePlan,
  parseVehicleFilters,
  removeFeature,
  REQUIREMENT_STEP,
  serializeVehicleFilters,
  vehicleStepStates,
} from "@/lib/admin-vehicle-ui";

describe("admin vehicle workflow helpers", () => {
  it("maps readiness requirements to the step that resolves them and reports completion", () => {
    expect(REQUIREMENT_STEP.mileageKm).toBe(4);
    expect(REQUIREMENT_STEP.driverNote).toBe(3);
    expect(REQUIREMENT_STEP.coverImage).toBe(6);
    const states = vehicleStepStates(4, [
      { key: "mileageKm", met: false },
      { key: "seats", met: true },
      { key: "description", met: true },
    ]);
    expect(states[3]).toMatchObject({ current: true, complete: false });
    expect(states[4]).toMatchObject({ current: false, complete: true });
  });

  it("clears disabled modes atomically and emits transitions only for subsequent status changes", () => {
    const disabled = buildVehicleModePlan(
      {
        isForSale: true,
        saleStatus: "available",
        isForRent: true,
        rentalStatus: "available",
      },
      {
        isForSale: false,
        saleStatus: "sold",
        salePrice: 1,
        isNegotiable: false,
        isForRent: false,
        rentalStatus: "rented",
        rentalDailyPrice: 2,
        minRentalDays: 3,
      },
    );
    expect(disabled.data).toMatchObject({
      saleStatus: null,
      salePrice: null,
      rentalStatus: null,
      rentalDailyPrice: null,
      minRentalDays: null,
    });
    expect(disabled.transitions).toEqual([]);

    const changed = buildVehicleModePlan(
      {
        isForSale: true,
        saleStatus: "available",
        isForRent: true,
        rentalStatus: "available",
      },
      {
        isForSale: true,
        saleStatus: "sold",
        salePrice: 100,
        isNegotiable: true,
        isForRent: true,
        rentalStatus: "reserved",
        rentalDailyPrice: 20,
        minRentalDays: 2,
      },
    );
    expect(changed.data.saleStatus).toBe("available");
    expect(changed.data.rentalStatus).toBe("available");
    expect(changed.transitions).toEqual(["sale_sold", "rental_reserved"]);
  });

  it("adds, trims, removes, deduplicates, and caps features", () => {
    expect(addFeature([], "  Air conditioning  ")).toEqual({
      features: ["Air conditioning"],
      error: null,
    });
    expect(addFeature(["ABS"], "ABS").error).toMatch(/already/);
    expect(addFeature([], "  ").error).toMatch(/Enter/);
    expect(
      addFeature(
        Array.from({ length: 50 }, (_, index) => `F${index}`),
        "Overflow",
      ).error,
    ).toMatch(/50/);
    expect(removeFeature(["ABS", "Airbags"], 0)).toEqual(["Airbags"]);
  });

  it("parses and serializes only approved safe filters", () => {
    const filters = parseVehicleFilters({
      search: " Land Cruiser ",
      listingState: "published",
      isForRent: "true",
      featured: "not-a-boolean",
      brandId: "not-a-uuid",
      registrationNumber: "PRIVATE",
      chassisNumber: "PRIVATE-2",
      page: "2",
    });
    expect(filters).toMatchObject({
      search: "Land Cruiser",
      listingState: "published",
      isForRent: "true",
      featured: "",
      brandId: "",
      page: 2,
    });
    const url = serializeVehicleFilters(filters);
    expect(url).toContain("search=Land+Cruiser");
    expect(url).toContain("listingState=published");
    expect(url).not.toMatch(/registration|chassis|PRIVATE/i);
  });
});
