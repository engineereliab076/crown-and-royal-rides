import { describe, expect, it } from "vitest";

import { getClientIp } from "@/server/http/client-ip";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("getClientIp", () => {
  it("returns the first x-forwarded-for hop", () => {
    expect(
      getClientIp(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })),
    ).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "  203.0.113.9 " }))).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(getClientIp(headers({ "x-real-ip": "198.51.100.5" }))).toBe(
      "198.51.100.5",
    );
  });

  it("returns null when no address header is present", () => {
    expect(getClientIp(headers({}))).toBeNull();
  });

  it("returns null for an empty x-forwarded-for", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "" }))).toBeNull();
  });
});
