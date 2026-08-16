import { describe, expect, it } from "vitest";

import {
  canonicalCatalogueCacheKey,
  parseVehicleFilters,
  toAppliedFilters,
  type IgnoredFilter,
  type RawSearchParams,
  type VehicleMode,
} from "@/lib/vehicle-filters";
import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  DRIVETRAINS,
  FUEL_TYPES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";

function parse(params: RawSearchParams, mode: VehicleMode = "all") {
  return parseVehicleFilters(params, mode);
}

function reasonFor(ignored: readonly IgnoredFilter[], key: string) {
  return ignored.find((entry) => entry.key === key)?.reason;
}

describe("parseVehicleFilters — q", () => {
  it("trims and collapses internal whitespace", () => {
    expect(parse({ q: "  land   cruiser  " }).filters.q).toBe("land cruiser");
  });

  it("treats blank as absent without reporting", () => {
    const result = parse({ q: "   " });
    expect(result.filters.q).toBeNull();
    expect(result.ignoredFilters).toHaveLength(0);
  });

  it("ignores and reports an overlong query without truncating", () => {
    const result = parse({ q: "a".repeat(121) });
    expect(result.filters.q).toBeNull();
    expect(reasonFor(result.ignoredFilters, "q")).toBe("too_long");
  });

  it("accepts a query at the 120 character boundary", () => {
    expect(parse({ q: "a".repeat(120) }).filters.q).toHaveLength(120);
  });

  it("ignores and reports a repeated query", () => {
    const result = parse({ q: ["a", "b"] });
    expect(result.filters.q).toBeNull();
    expect(reasonFor(result.ignoredFilters, "q")).toBe("repeated");
  });
});

describe("parseVehicleFilters — brand", () => {
  it("normalizes to a lowercase slug", () => {
    expect(parse({ brand: "  Toyota-Land  " }).filters.brand).toBe(
      "toyota-land",
    );
  });

  it("rejects an invalid slug grammar without echoing the raw value", () => {
    const raw = "not a slug!!";
    const result = parse({ brand: raw });
    expect(result.filters.brand).toBeNull();
    expect(reasonFor(result.ignoredFilters, "brand")).toBe("invalid_slug");
    expect(JSON.stringify(result.ignoredFilters)).not.toContain("not a slug");
  });

  it("rejects an overlong slug", () => {
    expect(parse({ brand: "a".repeat(81) }).filters.brand).toBeNull();
  });
});

describe("parseVehicleFilters — enums", () => {
  const cases: Array<[string, readonly string[]]> = [
    ["bodyType", BODY_TYPES],
    ["condition", VEHICLE_CONDITIONS],
    ["transmission", TRANSMISSIONS],
    ["fuelType", FUEL_TYPES],
    ["drivetrain", DRIVETRAINS],
    ["driverOption", DRIVER_OPTIONS],
  ];

  it("accepts every declared enum value", () => {
    for (const [key, values] of cases) {
      for (const value of values) {
        const result = parse({ [key]: value });
        expect(
          (result.filters as unknown as Record<string, unknown>)[key],
          `${key}=${value}`,
        ).toBe(value);
        expect(result.ignoredFilters).toHaveLength(0);
      }
    }
  });

  it("ignores and reports an invalid enum value without echoing it", () => {
    for (const [key] of cases) {
      const result = parse({ [key]: "bogus-value" });
      expect(
        (result.filters as unknown as Record<string, unknown>)[key],
      ).toBeNull();
      expect(reasonFor(result.ignoredFilters, key)).toBe("invalid_enum");
      expect(JSON.stringify(result.ignoredFilters)).not.toContain(
        "bogus-value",
      );
    }
  });

  it("ignores and reports repeated enum values", () => {
    const result = parse({ bodyType: ["suv", "sedan"] });
    expect(result.filters.bodyType).toBeNull();
    expect(reasonFor(result.ignoredFilters, "bodyType")).toBe("repeated");
  });
});

describe("parseVehicleFilters — year bounds", () => {
  it("accepts strict integers within range", () => {
    const result = parse({ yearMin: "2015", yearMax: "2020" });
    expect(result.filters.yearMin).toBe(2015);
    expect(result.filters.yearMax).toBe(2020);
  });

  it("rejects prefix, exponent, and fractional forms", () => {
    for (const value of ["2019abc", "1e3", "2019.0", "-2019", " 2019"]) {
      const result = parse({ yearMin: value });
      expect(result.filters.yearMin, value).toBeNull();
      expect(reasonFor(result.ignoredFilters, "yearMin")).toBe(
        "invalid_integer",
      );
    }
  });

  it("reports out-of-range years distinctly", () => {
    expect(
      reasonFor(parse({ yearMin: "1979" }).ignoredFilters, "yearMin"),
    ).toBe("out_of_range");
    expect(
      reasonFor(parse({ yearMax: "2101" }).ignoredFilters, "yearMax"),
    ).toBe("out_of_range");
  });

  it("swaps inverted bounds and reports neither as invalid", () => {
    const result = parse({ yearMin: "2020", yearMax: "2010" });
    expect(result.filters.yearMin).toBe(2010);
    expect(result.filters.yearMax).toBe(2020);
    expect(result.ignoredFilters).toHaveLength(0);
  });
});

describe("parseVehicleFilters — price bounds", () => {
  it("accepts strict positive integers in sale mode", () => {
    const result = parse({ priceMin: "1000000", priceMax: "5000000" }, "sale");
    expect(result.filters.priceMin).toBe(1_000_000);
    expect(result.filters.priceMax).toBe(5_000_000);
  });

  it("rejects zero, negative, fractional, exponent, and unsafe values", () => {
    for (const value of ["0", "-5", "1.5", "1e6", "99999999999999999999"]) {
      const result = parse({ priceMin: value }, "sale");
      expect(result.filters.priceMin, value).toBeNull();
      expect(reasonFor(result.ignoredFilters, "priceMin")).toBe(
        "invalid_price",
      );
    }
  });

  it("swaps inverted price bounds in rental mode", () => {
    const result = parse({ priceMin: "900", priceMax: "100" }, "rental");
    expect(result.filters.priceMin).toBe(100);
    expect(result.filters.priceMax).toBe(900);
  });

  it("ignores price parameters in all mode and reports not_applicable", () => {
    const result = parse({ priceMin: "1000", priceMax: "2000" }, "all");
    expect(result.filters.priceMin).toBeNull();
    expect(result.filters.priceMax).toBeNull();
    expect(reasonFor(result.ignoredFilters, "priceMin")).toBe("not_applicable");
    expect(reasonFor(result.ignoredFilters, "priceMax")).toBe("not_applicable");
  });
});

describe("parseVehicleFilters — page", () => {
  it("accepts a strict positive integer", () => {
    expect(parse({ page: "3" }).page).toBe(3);
  });

  it("normalizes invalid or repeated pages to 1 and reports them", () => {
    for (const value of ["0", "abc", "1.5", "1e3", "-2"] as const) {
      const result = parse({ page: value });
      expect(result.page, value).toBe(1);
      expect(reasonFor(result.ignoredFilters, "page")).toBe("invalid_page");
    }
    const repeated = parse({ page: ["2", "3"] });
    expect(repeated.page).toBe(1);
    expect(reasonFor(repeated.ignoredFilters, "page")).toBe("invalid_page");
  });

  it("defaults a missing page to 1 without reporting", () => {
    const result = parse({});
    expect(result.page).toBe(1);
    expect(result.ignoredFilters).toHaveLength(0);
  });
});

describe("parseVehicleFilters — sort whitelist", () => {
  it("defaults missing sort to newest", () => {
    expect(parse({}).sort).toBe("newest");
  });

  it("falls back to newest and reports an unknown sort", () => {
    const result = parse({ sort: "cheapest" });
    expect(result.sort).toBe("newest");
    expect(reasonFor(result.ignoredFilters, "sort")).toBe("unknown_sort");
  });

  it("demotes relevance without a query and reports it", () => {
    const result = parse({ sort: "relevance" });
    expect(result.sort).toBe("newest");
    expect(reasonFor(result.ignoredFilters, "sort")).toBe(
      "relevance_requires_query",
    );
  });

  it("allows relevance when a query is present", () => {
    expect(parse({ sort: "relevance", q: "toyota" }).sort).toBe("relevance");
  });

  it("rejects price sorts in all mode but allows them in mode-specific pages", () => {
    const all = parse({ sort: "price_asc" }, "all");
    expect(all.sort).toBe("newest");
    expect(reasonFor(all.ignoredFilters, "sort")).toBe(
      "price_sort_not_supported",
    );
    expect(parse({ sort: "price_asc" }, "sale").sort).toBe("price_asc");
    expect(parse({ sort: "price_desc" }, "rental").sort).toBe("price_desc");
  });

  it("accepts year_desc in every mode", () => {
    for (const mode of ["all", "sale", "rental"] as const) {
      expect(parse({ sort: "year_desc" }, mode).sort).toBe("year_desc");
    }
  });
});

describe("parseVehicleFilters — unknown parameters and reporting", () => {
  it("reports unknown parameters with a sanitized key", () => {
    const result = parse({ foo: "bar" });
    expect(reasonFor(result.ignoredFilters, "foo")).toBe("unknown_parameter");
    expect(JSON.stringify(result.ignoredFilters)).not.toContain("bar");
  });

  it("replaces an unsafe unknown key with a placeholder", () => {
    const result = parse({ "<script>": "x" });
    const entry = result.ignoredFilters.find(
      (item) => item.reason === "unknown_parameter",
    );
    expect(entry?.key).toBe("unknown");
    expect(JSON.stringify(result.ignoredFilters)).not.toContain("<script>");
  });

  it("deduplicates and returns ignored entries in deterministic order", () => {
    const result = parse({
      yearMax: "2101",
      bodyType: "bogus",
      sort: "nope",
      zzz: "1",
      aaa: "2",
    });
    const serialized = result.ignoredFilters.map(
      (entry) => `${entry.key}:${entry.reason}`,
    );
    const sorted = [...serialized].sort();
    expect(serialized).toEqual(sorted);
    expect(new Set(serialized).size).toBe(serialized.length);
  });
});

describe("appliedFilters", () => {
  it("contains only accepted, normalized, non-null values", () => {
    const result = parse(
      { q: " toyota ", bodyType: "suv", yearMin: "2010", brand: "Toyota" },
      "all",
    );
    expect(result.appliedFilters).toEqual({
      q: "toyota",
      brand: "toyota",
      bodyType: "suv",
      yearMin: 2010,
    });
  });

  it("omits rejected filters entirely", () => {
    const applied = toAppliedFilters(parse({ bodyType: "bogus" }).filters);
    expect(applied).toEqual({});
  });
});

describe("canonicalCatalogueCacheKey", () => {
  const base = {
    mode: "all" as VehicleMode,
    sort: "newest" as const,
    page: 1,
    pageSize: 24,
  };

  it("produces identical keys for semantically equivalent normalized queries", () => {
    const a = parse({ bodyType: "suv", q: " toyota " }, "all");
    const b = parse({ q: "toyota", bodyType: "suv" }, "all");
    expect(canonicalCatalogueCacheKey({ ...base, filters: a.filters })).toBe(
      canonicalCatalogueCacheKey({ ...base, filters: b.filters }),
    );
  });

  it("differs when a normalized value differs", () => {
    const a = parse({ bodyType: "suv" }, "all");
    const b = parse({ bodyType: "sedan" }, "all");
    expect(
      canonicalCatalogueCacheKey({ ...base, filters: a.filters }),
    ).not.toBe(canonicalCatalogueCacheKey({ ...base, filters: b.filters }));
  });

  it.each([
    ["ampersands", "Crown & Royal"],
    ["equals signs", "trim=limited"],
    ["embedded punctuation", "SUV | AWD: 2025"],
    ["Unicode", "Toyota 日本語 🚙"],
    ["quotes", '"Royal" edition'],
    ["backslashes", "Crown\\Royal"],
    ["newlines and control-like whitespace", "Crown\n\tRoyal"],
  ])("round-trips normalized query text containing %s", (_label, rawQuery) => {
    const parsed = parse({ q: rawQuery });
    const key = canonicalCatalogueCacheKey({
      ...base,
      filters: parsed.filters,
    });
    const decoded = JSON.parse(key) as {
      filters: { q: string | null };
    };
    expect(decoded.filters.q).toBe(parsed.filters.q);
  });

  it("separates tuples that collide under naive delimiter-only concatenation", () => {
    const firstFilters = {
      ...parse({}).filters,
      q: "alpha|beta",
      brand: "gamma",
    };
    const secondFilters = {
      ...parse({}).filters,
      q: "alpha",
      brand: "beta|gamma",
    };
    expect([firstFilters.q, firstFilters.brand].join("|")).toBe(
      [secondFilters.q, secondFilters.brand].join("|"),
    );
    expect(
      canonicalCatalogueCacheKey({ ...base, filters: firstFilters }),
    ).not.toBe(canonicalCatalogueCacheKey({ ...base, filters: secondFilters }));
  });

  it("separates mode, page, sort, filter, and page-size identities", () => {
    const filters = parse({ q: "royal" }).filters;
    const keys = [
      canonicalCatalogueCacheKey({ ...base, filters }),
      canonicalCatalogueCacheKey({ ...base, mode: "sale", filters }),
      canonicalCatalogueCacheKey({ ...base, page: 2, filters }),
      canonicalCatalogueCacheKey({ ...base, sort: "year_desc", filters }),
      canonicalCatalogueCacheKey({
        ...base,
        filters: { ...filters, bodyType: "suv" },
      }),
      canonicalCatalogueCacheKey({ ...base, pageSize: 48, filters }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never contains raw ignored input", () => {
    const parsed = parse({ bodyType: "bogus-value", junk: "leak" }, "all");
    const key = canonicalCatalogueCacheKey({
      ...base,
      filters: parsed.filters,
    });
    expect(key).not.toContain("bogus-value");
    expect(key).not.toContain("leak");
  });

  it("serializes the whole parsed query with plain JSON.stringify", () => {
    const parsed = parse({ q: "toyota", bodyType: "suv", page: "2" }, "sale");
    expect(() => JSON.stringify(parsed)).not.toThrow();
    expect(JSON.parse(JSON.stringify(parsed)).sort).toBe("newest");
  });
});
