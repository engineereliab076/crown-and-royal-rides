import { describe, expect, it } from "vitest";

import {
  resolveVehiclePublicState,
  type VehicleStateInput,
} from "@/lib/vehicle-public-state";

function input(overrides: Partial<VehicleStateInput> = {}): VehicleStateInput {
  return {
    listingState: "published",
    isForSale: true,
    saleStatus: "available",
    salePrice: 150_000_000,
    isForRent: false,
    rentalStatus: null,
    rentalDailyPrice: null,
    minRentalDays: null,
    ...overrides,
  };
}

describe("resolveVehiclePublicState — the public state truth table", () => {
  it("draft resolves to non-indexable unavailable with no actions", () => {
    const state = resolveVehiclePublicState(input({ listingState: "draft" }));
    expect(state.state).toBe("unavailable");
    expect(state.indexable).toBe(false);
    expect(state.inquiryAllowed).toBe(false);
    expect(state.whatsappAllowed).toBe(false);
    expect(state.showSalePrice).toBe(false);
    expect(state.badge).toBe("unavailable");
  });

  it("archived resolves to retired: noindex, nofollow, no actions", () => {
    const state = resolveVehiclePublicState(
      input({ listingState: "archived" }),
    );
    expect(state.state).toBe("retired");
    expect(state.robots).toEqual({ index: false, follow: false });
    expect(state.inquiryAllowed).toBe(false);
    expect(state.whatsappAllowed).toBe(false);
    expect(state.showSalePrice).toBe(false);
    expect(state.showRentalPrice).toBe(false);
    expect(state.badge).toBe("retired");
  });

  it("archived is retired regardless of the underlying commercial status", () => {
    expect(
      resolveVehiclePublicState(
        input({ listingState: "archived", saleStatus: "sold" }),
      ).state,
    ).toBe("retired");
    expect(
      resolveVehiclePublicState(
        input({
          listingState: "archived",
          isForSale: false,
          isForRent: true,
          rentalStatus: "available",
          rentalDailyPrice: 200_000,
          minRentalDays: 2,
        }),
      ).state,
    ).toBe("retired");
  });

  it("published sale-available is active, actionable, indexable, for-sale", () => {
    const state = resolveVehiclePublicState(input());
    expect(state.state).toBe("active");
    expect(state.saleActionable).toBe(true);
    expect(state.showSalePrice).toBe(true);
    expect(state.inquiryAllowed).toBe(true);
    expect(state.whatsappAllowed).toBe(true);
    expect(state.robots).toEqual({ index: true, follow: true });
    expect(state.badge).toBe("for-sale");
  });

  it("published rental-available is active and for-rent", () => {
    const state = resolveVehiclePublicState(
      input({
        isForSale: false,
        saleStatus: null,
        salePrice: null,
        isForRent: true,
        rentalStatus: "available",
        rentalDailyPrice: 200_000,
        minRentalDays: 3,
      }),
    );
    expect(state.state).toBe("active");
    expect(state.rentalActionable).toBe(true);
    expect(state.showRentalPrice).toBe(true);
    expect(state.badge).toBe("for-rent");
  });

  it("dual actionable modes resolve to for-sale-and-rent", () => {
    const state = resolveVehiclePublicState(
      input({
        isForRent: true,
        rentalStatus: "available",
        rentalDailyPrice: 200_000,
        minRentalDays: 2,
      }),
    );
    expect(state.saleActionable).toBe(true);
    expect(state.rentalActionable).toBe(true);
    expect(state.badge).toBe("for-sale-and-rent");
  });

  it("reserved-only is active and reserved but not actionable; price still shows", () => {
    const state = resolveVehiclePublicState(input({ saleStatus: "reserved" }));
    expect(state.state).toBe("active");
    expect(state.saleActionable).toBe(false);
    expect(state.inquiryAllowed).toBe(false);
    expect(state.showSalePrice).toBe(true);
    expect(state.badge).toBe("reserved");
    // Still listed/indexable — it just has nothing currently available.
    expect(state.indexable).toBe(true);
  });

  it("published sale-only sold is historical: noindex/follow, no purchase action", () => {
    const state = resolveVehiclePublicState(input({ saleStatus: "sold" }));
    expect(state.state).toBe("sold-historical");
    expect(state.robots).toEqual({ index: false, follow: true });
    expect(state.saleActionable).toBe(false);
    expect(state.inquiryAllowed).toBe(false);
    expect(state.showSalePrice).toBe(false);
    expect(state.badge).toBe("sold");
  });

  it("sold sale but available rental remains active and rentable, no purchase action", () => {
    const state = resolveVehiclePublicState(
      input({
        saleStatus: "sold",
        isForRent: true,
        rentalStatus: "available",
        rentalDailyPrice: 250_000,
        minRentalDays: 2,
      }),
    );
    expect(state.state).toBe("active");
    expect(state.rentalActionable).toBe(true);
    expect(state.showRentalPrice).toBe(true);
    // The sold sale price must never produce a purchase action or price.
    expect(state.saleActionable).toBe(false);
    expect(state.showSalePrice).toBe(false);
    expect(state.badge).toBe("for-rent");
  });

  it("published rental-only with a dead rental status is unavailable, not sold", () => {
    for (const rentalStatus of ["rented", "unavailable"]) {
      const state = resolveVehiclePublicState(
        input({
          isForSale: false,
          saleStatus: null,
          salePrice: null,
          isForRent: true,
          rentalStatus,
          rentalDailyPrice: 200_000,
          minRentalDays: 2,
        }),
      );
      expect(state.state).toBe("unavailable");
      expect(state.robots).toEqual({ index: false, follow: true });
      expect(state.badge).toBe("unavailable");
      expect(state.inquiryAllowed).toBe(false);
    }
  });

  it("does not show a sale price when the amount is missing or non-positive", () => {
    expect(
      resolveVehiclePublicState(input({ salePrice: null })).showSalePrice,
    ).toBe(false);
    expect(
      resolveVehiclePublicState(input({ salePrice: 0 })).showSalePrice,
    ).toBe(false);
  });

  it("mirrors robots.index into the indexable flag", () => {
    expect(resolveVehiclePublicState(input()).indexable).toBe(true);
    expect(
      resolveVehiclePublicState(input({ listingState: "archived" })).indexable,
    ).toBe(false);
  });
});
