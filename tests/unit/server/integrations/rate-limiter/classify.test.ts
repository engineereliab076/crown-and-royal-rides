import { describe, expect, it } from "vitest";
import { errors as upstashErrors } from "@upstash/redis";

import {
  classifyUpstashError,
  rateLimitCodeFrom,
  RateLimitProviderError,
} from "@/server/integrations/rate-limiter/classify";

const { UpstashError, UpstashJSONParseError, UrlError } = upstashErrors;

const SENSITIVE = [
  "owner@example.com",
  "198.51.100.42",
  "hunter2",
  "https://real-redis.upstash.io",
  "AeToken_SECRET_VALUE",
  "auth:login:email:abcdef",
];

function named(name: string, message = "boom"): Error {
  return Object.assign(new Error(message), { name });
}

describe("classifyUpstashError — every category maps to a stable code", () => {
  it("maps a bad URL to configuration missing", () => {
    expect(classifyUpstashError(new UrlError("https://x"))).toBe(
      "RATE_LIMIT_CONFIGURATION_MISSING",
    );
  });

  it("maps an unparseable provider body to response invalid", () => {
    expect(
      classifyUpstashError(new UpstashJSONParseError("<html>500</html>")),
    ).toBe("RATE_LIMIT_PROVIDER_RESPONSE_INVALID");
  });

  it("maps an aborted/timed-out request to provider timeout", () => {
    expect(classifyUpstashError(named("AbortError"))).toBe(
      "RATE_LIMIT_PROVIDER_TIMEOUT",
    );
    expect(classifyUpstashError(named("TimeoutError"))).toBe(
      "RATE_LIMIT_PROVIDER_TIMEOUT",
    );
  });

  it("maps a transport failure to provider unreachable", () => {
    expect(classifyUpstashError(new TypeError("fetch failed"))).toBe(
      "RATE_LIMIT_PROVIDER_UNREACHABLE",
    );
    const withCause = new Error("network down", {
      cause: { code: "ENOTFOUND" },
    });
    expect(classifyUpstashError(withCause)).toBe(
      "RATE_LIMIT_PROVIDER_UNREACHABLE",
    );
  });

  it("maps an unauthorized provider error to unauthorized", () => {
    expect(
      classifyUpstashError(new UpstashError("Unauthorized, command was: ...")),
    ).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
    expect(
      classifyUpstashError(new UpstashError("WRONGPASS invalid token")),
    ).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
  });

  it("maps a forbidden provider error to forbidden", () => {
    expect(
      classifyUpstashError(new UpstashError("Forbidden: permission denied")),
    ).toBe("RATE_LIMIT_PROVIDER_FORBIDDEN");
  });

  it("maps an unrecognized provider error to the generic provider code", () => {
    expect(classifyUpstashError(new UpstashError("some other failure"))).toBe(
      "RATE_LIMIT_PROVIDER_ERROR",
    );
  });

  it("maps a completely unknown throw to the generic provider code", () => {
    expect(classifyUpstashError(new Error("???"))).toBe(
      "RATE_LIMIT_PROVIDER_ERROR",
    );
    expect(classifyUpstashError("not-an-error")).toBe(
      "RATE_LIMIT_PROVIDER_ERROR",
    );
    expect(classifyUpstashError(undefined)).toBe("RATE_LIMIT_PROVIDER_ERROR");
  });
});

describe("classification never leaks sensitive content", () => {
  it("returns only the stable code even when the error embeds secrets", () => {
    for (const secret of SENSITIVE) {
      const code = classifyUpstashError(
        new UpstashError(
          `Unauthorized for ${secret}, command was: ["INCR","${secret}"]`,
        ),
      );
      expect(code).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
      expect(code).not.toContain(secret);
    }
  });
});

describe("RateLimitProviderError + rateLimitCodeFrom", () => {
  it("carries a stable code and never serializes its cause", () => {
    const raw = new UpstashError(
      "Unauthorized for owner@example.com, command was: [...]",
    );
    const error = new RateLimitProviderError(
      "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
      raw,
    );
    expect(error.diagnosticCode).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
    // A safe, generic message — no provider text or identifiers.
    expect(error.message).not.toContain("owner@example.com");
    expect(JSON.stringify({ code: error.diagnosticCode })).not.toContain(
      "owner@example.com",
    );
  });

  it("extracts the code from a provider error and defaults safely", () => {
    expect(
      rateLimitCodeFrom(
        new RateLimitProviderError("RATE_LIMIT_PROVIDER_TIMEOUT"),
      ),
    ).toBe("RATE_LIMIT_PROVIDER_TIMEOUT");
    expect(rateLimitCodeFrom(new Error("plain"))).toBe(
      "RATE_LIMIT_PROVIDER_ERROR",
    );
  });
});
