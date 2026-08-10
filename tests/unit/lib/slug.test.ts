import { describe, expect, it } from "vitest";

import { createPackageSlug, createVehicleSlug, slugify } from "@/lib/slug";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("slugify", () => {
  it.each([
    ["Toyota Land Cruiser Prado", "toyota-land-cruiser-prado"],
    ["  Dar es Salaam  ", "dar-es-salaam"],
    ["Cars & Weddings", "cars-and-weddings"],
    ["Café Transfer", "cafe-transfer"],
    ["Toyota---Harrier", "toyota-harrier"],
    ["...Toyota / Prado!!!", "toyota-prado"],
    ["Route 66", "route-66"],
    ["already-normalized", "already-normalized"],
    ["A___B...C", "a-b-c"],
  ] as const)("normalizes %j", (value, expected) => {
    expect(slugify(value)).toBe(expected);
  });

  it("does not mutate the supplied value", () => {
    const value = "  Café & Cars  ";

    slugify(value);

    expect(value).toBe("  Café & Cars  ");
  });

  it.each(["", "   ", "---", "!!!"])(
    "rejects an empty-result value %j with a stable safe TypeError",
    (value) => {
      expect(() => slugify(value)).toThrow(TypeError);
      expect(() => slugify(value)).toThrow(
        "Value must contain characters usable in a slug.",
      );
    },
  );

  it.each([
    "toyota",
    "toyota-land-cruiser",
    "route-66",
    slugify("Café & Airport Transfer"),
  ])("always satisfies the final invariant for %s", (value) => {
    expect(value).toMatch(SLUG_PATTERN);
    expect(value).not.toContain("--");
  });
});

describe("createVehicleSlug", () => {
  it("creates the exact architecture format", () => {
    expect(
      createVehicleSlug({
        brand: "Toyota",
        model: "Land Cruiser Prado",
        year: 2020,
        shortId: "A1B2C3",
      }),
    ).toBe("toyota-land-cruiser-prado-2020-a1b2c3");
  });

  it("normalizes a multiword brand, model, and lowercase short ID", () => {
    expect(
      createVehicleSlug({
        brand: "Mercedes Benz",
        model: "E Class AMG",
        year: 2024,
        shortId: "abc123",
      }),
    ).toBe("mercedes-benz-e-class-amg-2024-abc123");
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2020.5,
    Number.MAX_SAFE_INTEGER + 1,
    1979,
    2101,
  ])("rejects invalid vehicle year %s", (year) => {
    expect(() =>
      createVehicleSlug({
        brand: "Toyota",
        model: "Prado",
        year,
        shortId: "abc123",
      }),
    ).toThrow(TypeError);
  });

  it.each([
    ["brand", "!!!", "Prado", "abc123"],
    ["model", "Toyota", "---", "abc123"],
    ["short ID", "Toyota", "Prado", "   "],
  ] as const)("rejects an unusable %s", (_field, brand, model, shortId) => {
    expect(() =>
      createVehicleSlug({ brand, model, year: 2020, shortId }),
    ).toThrow(TypeError);
  });

  it("satisfies the final slug invariant", () => {
    const slug = createVehicleSlug({
      brand: "Land Rover",
      model: "Range Rover",
      year: 2026,
      shortId: "ZX-90",
    });

    expect(slug).toMatch(SLUG_PATTERN);
  });
});

describe("createPackageSlug", () => {
  it("creates the exact architecture format", () => {
    expect(
      createPackageSlug({
        destination: "Dar es Salaam",
        descriptor: "Airport Transfer",
      }),
    ).toBe("dar-es-salaam-airport-transfer");
  });

  it.each([
    ["destination", "!!!", "Airport Transfer"],
    ["descriptor", "Dar es Salaam", "---"],
  ] as const)("rejects an unusable %s", (_field, destination, descriptor) => {
    expect(() => createPackageSlug({ destination, descriptor })).toThrow(
      TypeError,
    );
  });

  it("is deterministic across repeated calls and satisfies the invariant", () => {
    const input = {
      destination: "Zanzibar",
      descriptor: "Beach & Safari",
    };
    const first = createPackageSlug(input);
    const second = createPackageSlug(input);

    expect(first).toBe("zanzibar-beach-and-safari");
    expect(second).toBe(first);
    expect(first).toMatch(SLUG_PATTERN);
  });
});
