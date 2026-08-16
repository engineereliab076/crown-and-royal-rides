import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { NormalizedVehicleFilters } from "@/lib/vehicle-filters";
import {
  composeWhereSql,
  filterPredicatesSql,
  orderBySql,
  searchMatchSql,
} from "@/server/modules/vehicles/search-sql";

function filters(
  overrides: Partial<NormalizedVehicleFilters> = {},
): NormalizedVehicleFilters {
  return {
    q: null,
    brand: null,
    bodyType: null,
    condition: null,
    transmission: null,
    fuelType: null,
    drivetrain: null,
    driverOption: null,
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    ...overrides,
  };
}

describe("search SQL construction binds every dynamic value", () => {
  it("keeps Phase 7 search and performance sources free of unsafe Prisma raw methods", () => {
    const sourcePaths = [
      "src/server/modules/vehicles/search-sql.ts",
      "src/server/modules/vehicles/public-repository.ts",
      "tests/integration/public/vehicle-search-performance.test.ts",
    ];
    const unsafeMethodNames = [
      ["$execute", "RawUnsafe"].join(""),
      ["$query", "RawUnsafe"].join(""),
    ];

    for (const sourcePath of sourcePaths) {
      const source = readFileSync(join(process.cwd(), sourcePath), "utf8");
      for (const methodName of unsafeMethodNames) {
        expect(source, `${sourcePath} contains ${methodName}`).not.toContain(
          methodName,
        );
      }
    }
  });

  it("binds a brand slug as a parameter, never inline in the SQL text", () => {
    const injection = "toyota'; DROP TABLE vehicles;--";
    const where = composeWhereSql("all", filters({ brand: injection }), {});
    expect(where.values).toContain(injection);
    expect(where.sql).not.toContain("DROP TABLE");
    // Prisma renders bound values as `?` placeholders (driver assigns $n).
    expect(where.sql).toContain("b.slug = ?");
  });

  it("binds the search term in the match predicate and never interpolates it", () => {
    const q = "o'brien % _ special";
    const match = searchMatchSql(q);
    expect(match.values).toContain(q);
    expect(match.sql).not.toContain("o'brien");
  });

  it("binds price bounds as bigint parameters on the mode column", () => {
    const preds = filterPredicatesSql(
      "sale",
      filters({ priceMin: 1_000_000, priceMax: 5_000_000 }),
    );
    const all = preds.map((p) => ({ sql: p.sql, values: p.values }));
    const values = all.flatMap((p) => p.values);
    expect(values).toContain(BigInt(1_000_000));
    expect(values).toContain(BigInt(5_000_000));
    expect(all.some((p) => p.sql.includes("sale_price"))).toBe(true);
  });

  it("uses the rental price column for rental-mode price bounds", () => {
    const preds = filterPredicatesSql("rental", filters({ priceMin: 100 }));
    expect(preds.some((p) => p.sql.includes("rental_daily_price"))).toBe(true);
    expect(preds.flatMap((p) => p.values)).toContain(BigInt(100));
  });

  it("excludes the named dimension from self-excluded facet predicates", () => {
    const withBrand = filterPredicatesSql(
      "all",
      filters({ brand: "toyota", bodyType: "suv" }),
      { exclude: "brand" },
    );
    const joined = withBrand.map((p) => p.sql).join(" ");
    expect(joined).toContain("body_type");
    expect(withBrand.flatMap((p) => p.values)).not.toContain("toyota");
  });

  it("binds year bounds as integer parameters", () => {
    const preds = filterPredicatesSql(
      "all",
      filters({ yearMin: 2010, yearMax: 2020 }),
    );
    const values = preds.flatMap((p) => p.values);
    expect(values).toContain(2010);
    expect(values).toContain(2020);
  });
});

describe("orderBySql whitelist", () => {
  it("newest and year_desc end in a deterministic id tie-break", () => {
    expect(orderBySql("all", "newest", null).sql).toMatch(/v\.id ASC$/);
    expect(orderBySql("all", "year_desc", null).sql).toMatch(/v\.id ASC$/);
  });

  it("price sorts target the mode-appropriate column", () => {
    expect(orderBySql("sale", "price_asc", null).sql).toContain("sale_price");
    expect(orderBySql("rental", "price_desc", null).sql).toContain(
      "rental_daily_price",
    );
  });

  it("relevance ranks by full-text then trigram similarity with a bound query", () => {
    const order = orderBySql("all", "relevance", "toyota");
    expect(order.sql).toContain("ts_rank_cd");
    expect(order.sql).toContain("similarity");
    expect(order.values).toContain("toyota");
    expect(order.sql).toMatch(/v\.id ASC$/);
  });
});
