import { describe, expect, it } from "vitest";

import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";

export interface RateLimiterContractHarness {
  readonly limiter: RateLimiter;
  setTime(timestamp: number): void;
}

export function runRateLimiterContract(
  name: string,
  createHarness: () => RateLimiterContractHarness,
): void {
  describe(`${name} RateLimiter contract`, () => {
    it("allows the first request and consumes one allowance", async () => {
      const { limiter } = createHarness();
      await expect(
        limiter.check("fake:vehicle-list", { limit: 3, windowMs: 1_000 }),
      ).resolves.toEqual({
        allowed: true,
        limit: 3,
        remaining: 2,
        resetAt: 1_000,
      });
    });

    it("allows the request at the limit, then blocks later checks", async () => {
      const { limiter } = createHarness();
      const policy = { limit: 2, windowMs: 1_000 };

      expect((await limiter.check("fake:inquiry", policy)).remaining).toBe(1);
      await expect(limiter.check("fake:inquiry", policy)).resolves.toEqual({
        allowed: true,
        limit: 2,
        remaining: 0,
        resetAt: 1_000,
      });
      await expect(limiter.check("fake:inquiry", policy)).resolves.toEqual({
        allowed: false,
        limit: 2,
        remaining: 0,
        resetAt: 1_000,
        retryAfterMs: 1_000,
      });
    });

    it("reports retry time relative to the current clock", async () => {
      const harness = createHarness();
      const policy = { limit: 1, windowMs: 1_000 };
      await harness.limiter.check("fake:login", policy);
      harness.setTime(250);

      await expect(
        harness.limiter.check("fake:login", policy),
      ).resolves.toMatchObject({
        allowed: false,
        resetAt: 1_000,
        retryAfterMs: 750,
      });
    });

    it("starts a new window at exactly resetAt", async () => {
      const harness = createHarness();
      const policy = { limit: 1, windowMs: 1_000 };
      await harness.limiter.check("fake:login", policy);
      harness.setTime(1_000);

      await expect(
        harness.limiter.check("fake:login", policy),
      ).resolves.toEqual({
        allowed: true,
        limit: 1,
        remaining: 0,
        resetAt: 2_000,
      });
    });

    it("isolates different keys", async () => {
      const { limiter } = createHarness();
      const policy = { limit: 1, windowMs: 1_000 };
      await limiter.check("fake:key-a", policy);

      await expect(limiter.check("fake:key-b", policy)).resolves.toMatchObject({
        allowed: true,
      });
    });

    it("isolates materially different policies for the same key", async () => {
      const { limiter } = createHarness();
      await limiter.check("fake:shared", { limit: 1, windowMs: 1_000 });

      await expect(
        limiter.check("fake:shared", { limit: 2, windowMs: 1_000 }),
      ).resolves.toMatchObject({ allowed: true, remaining: 1 });
      await expect(
        limiter.check("fake:shared", { limit: 1, windowMs: 2_000 }),
      ).resolves.toMatchObject({ allowed: true, resetAt: 2_000 });
    });

    it("rejects blank keys without exposing their value", async () => {
      const { limiter } = createHarness();
      const promise = limiter.check("   ", { limit: 1, windowMs: 1_000 });

      await expect(promise).rejects.toThrow(TypeError);
      await expect(promise).rejects.not.toThrow(/fake|address|ip/i);
    });

    it.each([
      [{ limit: 0, windowMs: 1_000 }, "limit"],
      [{ limit: 1.5, windowMs: 1_000 }, "limit"],
      [{ limit: 1, windowMs: 0 }, "windowMs"],
      [{ limit: 1, windowMs: Number.MAX_SAFE_INTEGER + 1 }, "windowMs"],
    ])("rejects invalid policy %#", async (policy, field) => {
      await expect(
        createHarness().limiter.check("fake:key", policy),
      ).rejects.toThrow(new RegExp(field));
    });
  });
}
