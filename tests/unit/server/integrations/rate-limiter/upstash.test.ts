import { describe, expect, it, vi } from "vitest";
import { errors as upstashErrors } from "@upstash/redis";

import { RateLimitProviderError } from "@/server/integrations/rate-limiter/classify";
import { IntegrationUnavailableError } from "@/server/integrations/errors";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import {
  UpstashRateLimiter,
  type UpstashLimiterFactory,
} from "@/server/integrations/rate-limiter/upstash";
import { runRateLimiterContract } from "./contract";

const { UpstashError } = upstashErrors;

function configuration(maxPolicies?: number) {
  return {
    restUrl: "https://fake-redis.example.test",
    restToken: "fake-rest-token",
    namespace: "dev:",
    ...(maxPolicies === undefined ? {} : { maxPolicies }),
  };
}

runRateLimiterContract("UpstashRateLimiter", () => {
  let timestamp = 0;
  const factory: UpstashLimiterFactory = ({ limit, windowMs }) => {
    const memory = new InMemoryRateLimiter(() => timestamp);
    return {
      async limit(identifier) {
        const result = await memory.check(identifier, { limit, windowMs });
        return {
          success: result.allowed,
          limit: result.limit,
          remaining: result.remaining,
          reset: result.resetAt,
        };
      },
    };
  };
  return {
    limiter: new UpstashRateLimiter(configuration(), factory, () => timestamp),
    setTime(nextTimestamp) {
      timestamp = nextTimestamp;
    },
  };
});

describe("UpstashRateLimiter provider mapping", () => {
  it("prefixes identifiers, maps provider output, and hides the raw key", async () => {
    const providerLimit = vi.fn(async () => ({
      success: false,
      limit: 2,
      remaining: 0,
      reset: 1_000,
    }));
    const factory = vi.fn<UpstashLimiterFactory>(() => ({
      limit: providerLimit,
    }));
    const limiter = new UpstashRateLimiter(configuration(), factory, () => 250);

    await expect(
      limiter.check("raw-client-key", { limit: 2, windowMs: 1_000 }),
    ).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetAt: 1_000,
      retryAfterMs: 750,
    });
    expect(factory).toHaveBeenCalledWith({
      limit: 2,
      windowMs: 1_000,
      namespace: "dev:",
    });
    expect(providerLimit).toHaveBeenCalledWith("dev:raw-client-key");
  });

  it("reuses policy instances and bounds the least-recently-used cache", async () => {
    const factory = vi.fn<UpstashLimiterFactory>(({ limit, windowMs }) => ({
      limit: vi.fn(async () => ({
        success: true,
        limit,
        remaining: Math.max(limit - 1, 0),
        reset: windowMs,
      })),
    }));
    const limiter = new UpstashRateLimiter(configuration(2), factory, () => 0);

    await limiter.check("one", { limit: 1, windowMs: 1_000 });
    await limiter.check("two", { limit: 2, windowMs: 1_000 });
    await limiter.check("one", { limit: 1, windowMs: 1_000 });
    await limiter.check("three", { limit: 3, windowMs: 1_000 });
    await limiter.check("two", { limit: 2, windowMs: 1_000 });

    expect(factory).toHaveBeenCalledTimes(4);
    expect(limiter.getCachedPolicyCount()).toBe(2);
  });

  it("translates thrown provider failures into a safe neutral error", async () => {
    const marker = "RAW_UPSTASH_FAILURE_MARKER";
    const limiter = new UpstashRateLimiter(configuration(), () => ({
      async limit() {
        throw new Error(marker);
      },
    }));

    let caught: unknown;
    try {
      await limiter.check("fake-key", { limit: 1, windowMs: 1_000 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IntegrationUnavailableError);
    expect((caught as Error).message).not.toContain(marker);
  });

  it.each([
    { success: true, limit: 999, remaining: 0, reset: 1_000 },
    { success: true, limit: 1, remaining: -1, reset: 1_000 },
    { success: true, limit: 1, remaining: 0, reset: Number.NaN },
  ])("rejects malformed provider response %#", async (response) => {
    const limiter = new UpstashRateLimiter(configuration(), () => ({
      limit: vi.fn(async () => response),
    }));
    await expect(
      limiter.check("fake-key", { limit: 1, windowMs: 1_000 }),
    ).rejects.toBeInstanceOf(IntegrationUnavailableError);
  });

  it("validates before creating a provider policy", async () => {
    const factory = vi.fn<UpstashLimiterFactory>();
    const limiter = new UpstashRateLimiter(configuration(), factory);
    await expect(
      limiter.check(" ", { limit: 1, windowMs: 1_000 }),
    ).rejects.toThrow(TypeError);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("UpstashRateLimiter — safe failure classification", () => {
  async function codeFor(
    limitImpl: () => Promise<{
      success: boolean;
      limit: number;
      remaining: number;
      reset: number;
      reason?: string;
    }>,
  ): Promise<string> {
    const limiter = new UpstashRateLimiter(configuration(), () => ({
      limit: limitImpl,
    }));
    try {
      await limiter.check("fake-key", { limit: 1, windowMs: 1_000 });
      return "NO_THROW";
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitProviderError);
      expect(error).toBeInstanceOf(IntegrationUnavailableError);
      return (error as RateLimitProviderError).diagnosticCode;
    }
  }

  it("maps an unauthorized provider error to the unauthorized code", async () => {
    const code = await codeFor(async () => {
      throw new UpstashError('Unauthorized, command was: ["INCR","k"]');
    });
    expect(code).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
  });

  it("converts the library fail-open timeout sentinel into a fail-closed timeout", async () => {
    // @upstash/ratelimit resolves this shape when its own deadline elapses.
    const code = await codeFor(async () => ({
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "timeout",
    }));
    expect(code).toBe("RATE_LIMIT_PROVIDER_TIMEOUT");
  });

  it("maps a malformed response to the response-invalid code", async () => {
    const code = await codeFor(async () => ({
      success: true,
      limit: 999,
      remaining: 0,
      reset: 1_000,
    }));
    expect(code).toBe("RATE_LIMIT_PROVIDER_RESPONSE_INVALID");
  });

  it("treats a genuine block as a decision, not a provider failure", async () => {
    const limiter = new UpstashRateLimiter(configuration(), () => ({
      limit: async () => ({
        success: false,
        limit: 1,
        remaining: 0,
        reset: 5_000,
      }),
    }));
    await expect(
      limiter.check("fake-key", { limit: 1, windowMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("keeps identifiers, keys, and provider text out of the thrown error", async () => {
    const secret = "auth:login:email:SECRETHASH";
    const limiter = new UpstashRateLimiter(configuration(), () => ({
      async limit() {
        throw new UpstashError(
          `Unauthorized for owner@example.com, command was: [\"INCR\",\"${secret}\"]`,
        );
      },
    }));
    let caught: unknown;
    try {
      await limiter.check("client-key", { limit: 1, windowMs: 1_000 });
    } catch (error) {
      caught = error;
    }
    const serialized = `${(caught as Error).message} ${JSON.stringify({
      code: (caught as RateLimitProviderError).diagnosticCode,
    })}`;
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("client-key");
    expect(serialized).not.toContain("fake-rest-token");
    expect(serialized).not.toContain("fake-redis.example.test");
  });
});
