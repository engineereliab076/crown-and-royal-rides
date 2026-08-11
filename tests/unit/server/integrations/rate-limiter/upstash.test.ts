import { describe, expect, it, vi } from "vitest";

import { IntegrationUnavailableError } from "@/server/integrations/errors";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import {
  UpstashRateLimiter,
  type UpstashLimiterFactory,
} from "@/server/integrations/rate-limiter/upstash";
import { runRateLimiterContract } from "./contract";

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
