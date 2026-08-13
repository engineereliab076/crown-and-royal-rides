import { describe, expect, it, vi } from "vitest";

import { RateLimitProviderError } from "@/server/integrations/rate-limiter/classify";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import {
  formatProbeLine,
  runRateLimitProbe,
} from "@/server/diagnostics/rate-limit-probe";

const CORRELATION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("runRateLimitProbe", () => {
  it("passes when the minimal check succeeds and uses a namespaced probe key", async () => {
    const check = vi.fn<RateLimiter["check"]>(async () => ({
      allowed: true,
      limit: 1_000_000,
      remaining: 999_999,
      resetAt: 10_000,
    }));

    const result = await runRateLimitProbe({
      rateLimiter: { check },
      correlationId: CORRELATION_ID,
    });

    expect(result).toEqual({
      ok: true,
      code: "RATE_LIMIT_OK",
      correlationId: CORRELATION_ID,
    });
    // A dedicated diagnostic key with a short window — never an auth key.
    const [key, policy] = check.mock.calls[0] ?? [];
    expect(key).toBe("diagnostic:probe");
    expect(policy).toMatchObject({ windowMs: 10_000 });
  });

  it("reports a stable provider code on failure without leaking detail", async () => {
    const check = vi.fn<RateLimiter["check"]>(async () => {
      throw new RateLimitProviderError(
        "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
        new Error("Unauthorized for owner@example.com"),
      );
    });

    const result = await runRateLimitProbe({
      rateLimiter: { check },
      correlationId: CORRELATION_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
    expect(JSON.stringify(result)).not.toContain("owner@example.com");
  });

  it("classifies an unknown throw as the generic provider code", async () => {
    const result = await runRateLimitProbe({
      rateLimiter: {
        check: async () => {
          throw new Error("mystery");
        },
      },
      correlationId: CORRELATION_ID,
    });
    expect(result).toEqual({
      ok: false,
      code: "RATE_LIMIT_PROVIDER_ERROR",
      correlationId: CORRELATION_ID,
    });
  });
});

describe("formatProbeLine", () => {
  it("prints only PASS/FAIL, the stable code, and the correlation ID", () => {
    expect(
      formatProbeLine({
        ok: true,
        code: "RATE_LIMIT_OK",
        correlationId: CORRELATION_ID,
      }),
    ).toBe(`PASS RATE_LIMIT_OK ${CORRELATION_ID}`);
    expect(
      formatProbeLine({
        ok: false,
        code: "RATE_LIMIT_PROVIDER_TIMEOUT",
        correlationId: CORRELATION_ID,
      }),
    ).toBe(`FAIL RATE_LIMIT_PROVIDER_TIMEOUT ${CORRELATION_ID}`);
  });
});
