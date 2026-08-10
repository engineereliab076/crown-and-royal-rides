import { describe, expect, it } from "vitest";

import { isValidTanzanianPhone, normalizeTanzanianPhone } from "@/lib/phone";

const CANONICAL_PHONE = "+255712345678";

describe("normalizeTanzanianPhone", () => {
  it.each(["0712345678", "255712345678", "+255712345678"])(
    "normalizes the supported compact form %s",
    (value) => {
      expect(normalizeTanzanianPhone(value)).toBe(CANONICAL_PHONE);
    },
  );

  it.each([
    "  0712345678  ",
    "0712 345 678",
    "0712-345-678",
    "0712 - 345 - 678",
    "255 712 345 678",
    "+255 712 345 678",
    "+255-712-345-678",
    "\t+255\t712 345-678\r\n",
  ])("accepts permitted whitespace and hyphen formatting in %j", (value) => {
    expect(normalizeTanzanianPhone(value)).toBe(CANONICAL_PHONE);
  });

  it("returns the exact canonical structure and length", () => {
    const result = normalizeTanzanianPhone("0712 345 678");

    expect(result).toHaveLength(13);
    expect(result).toMatch(/^\+255[0-9]{9}$/);
    expect(result.match(/\+/g)).toHaveLength(1);
    expect(result).not.toMatch(/[\s-]/);
  });

  it("maps equivalent inputs to one future inquiry-deduplication key", () => {
    const equivalentInputs = [
      "0712345678",
      "0712-345-678",
      "255 712 345 678",
      "+255712345678",
    ];
    const normalized = new Set(equivalentInputs.map(normalizeTanzanianPhone));

    expect(normalized.size).toBe(1);
    expect([...normalized]).toEqual([CANONICAL_PHONE]);
  });

  it.each([
    ["empty input", ""],
    ["whitespace-only input", "   "],
    ["separator-only input", " - - "],
    ["a bare national number", "712345678"],
    ["a short local number", "071234567"],
    ["a long local number", "07123456789"],
    ["a short international number", "25571234567"],
    ["a long international number", "2557123456789"],
    ["a foreign country code", "+254712345678"],
    ["00 notation", "00255712345678"],
    ["multiple plus signs", "++255712345678"],
    ["a middle plus sign", "255+712345678"],
    ["letters", "0712ABC678"],
    ["an extension", "0712345678 ext 2"],
    ["parentheses", "+255 (712) 345 678"],
    ["dots", "0712.345.678"],
    ["slashes", "0712/345/678"],
    ["underscores", "0712_345_678"],
    ["commas", "0712,345,678"],
    ["semicolons", "0712;345;678"],
    ["colons", "0712:345:678"],
    ["Arabic-Indic digits", "٠٧١٢٣٤٥٦٧٨"],
    ["full-width digits", "０７１２３４５６７８"],
  ])("rejects %s", (_description, value) => {
    expect(() => normalizeTanzanianPhone(value)).toThrow(TypeError);
  });

  it("uses a stable safe error without echoing the supplied phone", () => {
    const suppliedValue = "+254712345678";

    try {
      normalizeTanzanianPhone(suppliedValue);
      throw new Error("Expected normalization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);

      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).toContain("valid Tanzanian phone number");
      expect(error.message).not.toContain(suppliedValue);
    }
  });
});

describe("isValidTanzanianPhone", () => {
  it.each([
    "0712345678",
    "0712 345 678",
    "255712345678",
    "+255712345678",
    " +255-712-345-678 ",
  ])("returns true for accepted input %j", (value) => {
    expect(isValidTanzanianPhone(value)).toBe(true);
  });

  it.each([
    "",
    "712345678",
    "+254712345678",
    "00255712345678",
    "++255712345678",
    "0712.345.678",
    "0712345678 ext 2",
    "٠٧١٢٣٤٥٦٧٨",
  ])("returns false for rejected input %j", (value) => {
    expect(isValidTanzanianPhone(value)).toBe(false);
  });

  it("never throws for string input", () => {
    const inputs = ["", "not a phone", "+", "---", "+255712345678"];

    for (const input of inputs) {
      expect(() => isValidTanzanianPhone(input)).not.toThrow();
    }
  });
});
