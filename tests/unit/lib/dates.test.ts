import { describe, expect, it } from "vitest";

import {
  DAR_ES_SALAAM_TIME_ZONE,
  addCalendarDays,
  addCalendarMonths,
  compareDateOnly,
  differenceInCalendarDays,
  getDarEsSalaamToday,
  isDateWithinRequestWindow,
  isValidDateOnly,
} from "@/lib/dates";

describe("getDarEsSalaamToday", () => {
  it("exports the permanent business timezone", () => {
    expect(DAR_ES_SALAAM_TIME_ZONE).toBe("Africa/Dar_es_Salaam");
  });

  it("moves to the next Tanzania date after the UTC+3 boundary", () => {
    expect(getDarEsSalaamToday(new Date("2026-08-09T21:30:00.000Z"))).toBe(
      "2026-08-10",
    );
  });

  it("keeps the prior Tanzania date immediately before the boundary", () => {
    expect(getDarEsSalaamToday(new Date("2026-08-09T20:59:59.999Z"))).toBe(
      "2026-08-09",
    );
  });

  it("rejects an invalid Date", () => {
    expect(() => getDarEsSalaamToday(new Date(Number.NaN))).toThrow(TypeError);
  });
});

describe("isValidDateOnly", () => {
  it.each([
    "2026-01-01",
    "2026-02-28",
    "2028-02-29",
    "2000-02-29",
    "2400-02-29",
  ])("accepts the real Gregorian date %s", (value) => {
    expect(isValidDateOnly(value)).toBe(true);
  });

  it.each([
    "",
    "2026-1-1",
    "26-01-01",
    "2026/01/01",
    "2026-02-29",
    "2028-02-30",
    "1900-02-29",
    "2100-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01T00:00:00Z",
    "٢٠٢٦-٠١-٠١",
    "0000-01-01",
  ])("rejects malformed or impossible date %j", (value) => {
    expect(isValidDateOnly(value)).toBe(false);
  });

  it("never throws for string input", () => {
    expect(() => isValidDateOnly("not-a-date")).not.toThrow();
  });
});

describe("compareDateOnly", () => {
  it.each([
    ["2026-01-01", "2026-01-02", -1],
    ["2026-01-02", "2026-01-02", 0],
    ["2027-01-01", "2026-12-31", 1],
  ] as const)("compares %s and %s as %i", (left, right, expected) => {
    expect(compareDateOnly(left, right)).toBe(expected);
  });

  it("rejects an invalid left date", () => {
    expect(() => compareDateOnly("2026-02-29", "2026-03-01")).toThrow(
      TypeError,
    );
  });

  it("rejects an invalid right date", () => {
    expect(() => compareDateOnly("2026-03-01", "2026-03-1")).toThrow(TypeError);
  });
});

describe("addCalendarDays", () => {
  it.each([
    ["2026-01-15", 0, "2026-01-15"],
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2028-03-01", -1, "2028-02-29"],
  ] as const)("adds %i days to %s", (value, days, expected) => {
    expect(addCalendarDays(value, days)).toBe(expected);
  });

  it("rejects an invalid input date", () => {
    expect(() => addCalendarDays("2026-02-29", 1)).toThrow(TypeError);
  });

  it.each([
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid day offset %s", (days) => {
    expect(() => addCalendarDays("2026-01-01", days)).toThrow(TypeError);
  });
});

describe("differenceInCalendarDays", () => {
  it.each([
    ["2026-08-09", "2026-08-09", 0],
    ["2026-08-09", "2026-08-10", 1],
    ["2026-08-10", "2026-08-09", -1],
    ["2026-01-31", "2026-02-01", 1],
    ["2026-12-31", "2027-01-01", 1],
    ["2028-02-28", "2028-03-01", 2],
    ["2026-01-01", "2026-04-01", 90],
    ["2026-01-01", "2026-04-02", 91],
  ] as const)("returns %i from %s to %s", (start, end, expected) => {
    expect(differenceInCalendarDays(start, end)).toBe(expected);
  });

  it("rejects an invalid start date", () => {
    expect(() => differenceInCalendarDays("invalid", "2026-01-01")).toThrow(
      TypeError,
    );
  });

  it("rejects an invalid end date", () => {
    expect(() => differenceInCalendarDays("2026-01-01", "invalid")).toThrow(
      TypeError,
    );
  });
});

describe("addCalendarMonths", () => {
  it.each([
    ["2026-01-15", 1, "2026-02-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-01-15", -1, "2025-12-15"],
    ["2026-06-30", 0, "2026-06-30"],
  ] as const)("adds %i calendar months to %s", (value, months, expected) => {
    expect(addCalendarMonths(value, months)).toBe(expected);
  });

  it("rejects an invalid input date", () => {
    expect(() => addCalendarMonths("2026-13-01", 1)).toThrow(TypeError);
  });

  it.each([
    1.25,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid month offset %s", (months) => {
    expect(() => addCalendarMonths("2026-01-01", months)).toThrow(TypeError);
  });
});

describe("isDateWithinRequestWindow", () => {
  const afterTanzaniaMidnight = new Date("2026-08-09T21:30:00.000Z");

  it("includes today in Dar es Salaam", () => {
    expect(isDateWithinRequestWindow("2026-08-10", afterTanzaniaMidnight)).toBe(
      true,
    );
  });

  it("includes the date exactly 12 calendar months after today", () => {
    expect(isDateWithinRequestWindow("2027-08-10", afterTanzaniaMidnight)).toBe(
      true,
    );
  });

  it("rejects one day before today", () => {
    expect(isDateWithinRequestWindow("2026-08-09", afterTanzaniaMidnight)).toBe(
      false,
    );
  });

  it("rejects one day after the 12-month boundary", () => {
    expect(isDateWithinRequestWindow("2027-08-11", afterTanzaniaMidnight)).toBe(
      false,
    );
  });

  it("returns false for malformed customer input", () => {
    expect(isDateWithinRequestWindow("2026-8-10", afterTanzaniaMidnight)).toBe(
      false,
    );
  });

  it("accepts a same-day request at 23:30 in Dar es Salaam", () => {
    const atTanzania2330 = new Date("2026-08-09T20:30:00.000Z");

    expect(isDateWithinRequestWindow("2026-08-09", atTanzania2330)).toBe(true);
  });

  it("allows an invalid supplied now to throw", () => {
    expect(() =>
      isDateWithinRequestWindow("2026-08-10", new Date(Number.NaN)),
    ).toThrow(TypeError);
  });
});
