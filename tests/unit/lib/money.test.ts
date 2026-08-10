import { describe, expect, it } from "vitest";

import { formatTzs, toBigIntShillings, toShillings } from "@/lib/money";

const REALISTIC_VEHICLE_PRICE = 45_000_000;
const NON_BREAKING_SPACE = String.fromCharCode(0xa0);

describe("toShillings", () => {
  it("converts zero", () => {
    expect(toShillings(BigInt(0))).toBe(0);
  });

  it("converts a small whole amount", () => {
    expect(toShillings(BigInt(1_500_000))).toBe(1_500_000);
  });

  it("converts a realistic vehicle price", () => {
    expect(toShillings(BigInt(45_000_000))).toBe(REALISTIC_VEHICLE_PRICE);
  });

  it("converts the safe-integer maximum", () => {
    expect(toShillings(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects a negative bigint", () => {
    expect(() => toShillings(BigInt(-1))).toThrow(RangeError);
    expect(() => toShillings(BigInt(-1))).toThrow(/toShillings/);
  });

  it("rejects a bigint one greater than the safe-integer maximum", () => {
    const tooLarge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    expect(() => toShillings(tooLarge)).toThrow(RangeError);
    expect(() => toShillings(tooLarge)).toThrow(/non-negative/);
  });

  it("rejects a much larger bigint", () => {
    expect(() => toShillings(BigInt(10) ** BigInt(30))).toThrow(RangeError);
  });

  it("returns a value whose runtime type is number", () => {
    expect(typeof toShillings(BigInt(1_500_000))).toBe("number");
  });
});

describe("toBigIntShillings", () => {
  it("converts zero", () => {
    expect(toBigIntShillings(0)).toBe(BigInt(0));
  });

  it("converts a small whole amount", () => {
    expect(toBigIntShillings(1_500_000)).toBe(BigInt(1_500_000));
  });

  it("converts a realistic vehicle price", () => {
    expect(toBigIntShillings(REALISTIC_VEHICLE_PRICE)).toBe(BigInt(45_000_000));
  });

  it("converts the safe-integer maximum", () => {
    expect(toBigIntShillings(Number.MAX_SAFE_INTEGER)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
  });

  it("rejects a negative value", () => {
    expect(() => toBigIntShillings(-1)).toThrow(RangeError);
    expect(() => toBigIntShillings(-1)).toThrow(/non-negative safe integer/);
  });

  it("rejects a fractional value", () => {
    expect(() => toBigIntShillings(1.5)).toThrow(RangeError);
  });

  it("rejects NaN", () => {
    expect(() => toBigIntShillings(Number.NaN)).toThrow(RangeError);
  });

  it("rejects positive infinity", () => {
    expect(() => toBigIntShillings(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("rejects negative infinity", () => {
    expect(() => toBigIntShillings(Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("rejects a value greater than the safe-integer maximum", () => {
    expect(() => toBigIntShillings(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });

  it("returns a value whose runtime type is bigint", () => {
    expect(typeof toBigIntShillings(1_500_000)).toBe("bigint");
  });
});

describe("formatTzs", () => {
  it("formats zero", () => {
    expect(formatTzs(0)).toBe("TZS 0");
  });

  it("formats a value below one thousand", () => {
    expect(formatTzs(1)).toBe("TZS 1");
    expect(formatTzs(999)).toBe("TZS 999");
  });

  it("formats one thousand with grouping", () => {
    expect(formatTzs(1_000)).toBe("TZS 1,000");
  });

  it("formats 1,500,000", () => {
    expect(formatTzs(1_500_000)).toBe("TZS 1,500,000");
  });

  it("formats 45,000,000", () => {
    expect(formatTzs(45_000_000)).toBe("TZS 45,000,000");
  });

  it("formats the safe-integer maximum", () => {
    expect(formatTzs(Number.MAX_SAFE_INTEGER)).toBe(
      "TZS 9,007,199,254,740,991",
    );
  });

  it("uses an ordinary ASCII space after TZS", () => {
    const formatted = formatTzs(1_000);
    expect(formatted.startsWith("TZS ")).toBe(true);
    expect(formatted.charCodeAt(3)).toBe(32);
    expect(formatted).not.toContain(NON_BREAKING_SPACE);
  });

  it("appends no decimal suffix", () => {
    expect(formatTzs(1_500_000)).not.toContain(".");
  });

  it("rejects a negative value", () => {
    expect(() => formatTzs(-1)).toThrow(RangeError);
    expect(() => formatTzs(-1)).toThrow(/non-negative safe integer/);
  });

  it("rejects a fractional value", () => {
    expect(() => formatTzs(1.5)).toThrow(RangeError);
  });

  it("rejects NaN", () => {
    expect(() => formatTzs(Number.NaN)).toThrow(RangeError);
  });

  it("rejects positive infinity", () => {
    expect(() => formatTzs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects negative infinity", () => {
    expect(() => formatTzs(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects an unsafe integer", () => {
    expect(() => formatTzs(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("bigint <-> number round trip", () => {
  it("restores a JSON-serializable number for a DTO", () => {
    const original = 45_000_000;
    const stored = toBigIntShillings(original);
    const restored = toShillings(stored);

    expect(restored).toBe(original);
    expect(JSON.stringify({ price: restored })).toBe('{"price":45000000}');
  });
});
