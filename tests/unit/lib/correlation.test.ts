import { describe, expect, it } from "vitest";

import { createCorrelationId, isValidCorrelationId } from "@/lib/correlation";

describe("createCorrelationId", () => {
  it("returns a canonical lowercase UUID v4 string", () => {
    const value = createCorrelationId();

    expect(typeof value).toBe("string");
    expect(value).toHaveLength(36);
    expect(isValidCorrelationId(value)).toBe(true);
    expect(value[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(value[19]);
    expect(value).toBe(value.toLowerCase());
    expect(value).not.toMatch(/[{}\s]/);
    expect(value).not.toContain("urn:uuid:");
  });

  it("returns distinct values on multiple calls", () => {
    expect(createCorrelationId()).not.toBe(createCorrelationId());
  });

  it("produces 100 distinct valid identifiers", () => {
    const values = Array.from({ length: 100 }, createCorrelationId);

    expect(values.every(isValidCorrelationId)).toBe(true);
    expect(new Set(values).size).toBe(100);
  });
});

describe("isValidCorrelationId", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts a known canonical lowercase UUID v4", () => {
    expect(isValidCorrelationId(validUuid)).toBe(true);
  });

  it.each([
    ["uppercase", validUuid.toUpperCase()],
    ["version 1", "550e8400-e29b-11d4-a716-446655440000"],
    ["version 3", "550e8400-e29b-31d4-a716-446655440000"],
    ["version 5", "550e8400-e29b-51d4-a716-446655440000"],
    ["invalid variant", "550e8400-e29b-41d4-7716-446655440000"],
    ["missing hyphens", "550e8400e29b41d4a716446655440000"],
    ["too short", "550e8400-e29b-41d4-a716"],
    ["non-hex content", "550e8400-e29b-41d4-z716-446655440000"],
    ["leading whitespace", ` ${validUuid}`],
    ["trailing whitespace", `${validUuid} `],
    ["braces", `{${validUuid}}`],
    ["URN prefix", `urn:uuid:${validUuid}`],
    ["empty string", ""],
  ])("rejects %s", (_description, value) => {
    expect(isValidCorrelationId(value)).toBe(false);
  });

  it("never throws for string input", () => {
    const values = ["", "not-a-uuid", validUuid, validUuid.toUpperCase()];

    for (const value of values) {
      expect(() => isValidCorrelationId(value)).not.toThrow();
    }
  });
});
