import { describe, expect, it } from "vitest";

import {
  buildPaginatedResult,
  normalizePageParam,
  PUBLIC_PAGE_SIZE,
} from "@/lib/pagination";

describe("normalizePageParam", () => {
  it("defaults malformed, empty, or missing values to page 1", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "abc",
      "1.5",
      "-1",
      "0",
      "1e3",
      "0x10",
      Number.NaN,
      1.5,
      -3,
      0,
    ]) {
      expect(normalizePageParam(value)).toBe(1);
    }
  });

  it("accepts plain positive integer strings and numbers", () => {
    expect(normalizePageParam("1")).toBe(1);
    expect(normalizePageParam("12")).toBe(12);
    expect(normalizePageParam(7)).toBe(7);
  });

  it("uses the first entry of a repeated parameter", () => {
    expect(normalizePageParam(["3", "9"])).toBe(3);
    expect(normalizePageParam(["bad", "9"])).toBe(1);
  });
});

describe("buildPaginatedResult", () => {
  it("fixes the public page size at 24", () => {
    expect(PUBLIC_PAGE_SIZE).toBe(24);
    const result = buildPaginatedResult({
      items: [],
      page: 1,
      totalItems: 0,
    });
    expect(result.pageSize).toBe(24);
  });

  it("derives totals and navigation flags at the first boundary", () => {
    const result = buildPaginatedResult({
      items: new Array(24).fill(0),
      page: 1,
      totalItems: 50,
    });
    expect(result).toMatchObject({
      page: 1,
      pageSize: 24,
      totalItems: 50,
      totalPages: 3,
      hasPreviousPage: false,
      hasNextPage: true,
    });
  });

  it("derives navigation flags at the last boundary", () => {
    const result = buildPaginatedResult({
      items: new Array(2).fill(0),
      page: 3,
      totalItems: 50,
    });
    expect(result).toMatchObject({
      page: 3,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it("reports an empty set as zero pages with no navigation", () => {
    const result = buildPaginatedResult({ items: [], page: 1, totalItems: 0 });
    expect(result).toMatchObject({
      totalPages: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  it("a page beyond the end has a previous page but no next page", () => {
    const result = buildPaginatedResult({
      items: [],
      page: 5,
      totalItems: 50,
    });
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });
});
