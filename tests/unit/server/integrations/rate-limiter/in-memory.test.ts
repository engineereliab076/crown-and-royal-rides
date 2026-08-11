import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import { runRateLimiterContract } from "./contract";

runRateLimiterContract("InMemoryRateLimiter", () => {
  let timestamp = 0;
  return {
    limiter: new InMemoryRateLimiter(() => timestamp),
    setTime(nextTimestamp: number): void {
      timestamp = nextTimestamp;
    },
  };
});

describe("InMemoryRateLimiter inspection behavior", () => {
  it("returns frozen, copy-safe state snapshots", async () => {
    const limiter = new InMemoryRateLimiter(() => 250);
    await limiter.check("fake:inquiry", { limit: 3, windowMs: 1_000 });

    const state = limiter.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state[0])).toBe(true);
    expect(Object.isFrozen(state[0]?.policy)).toBe(true);
    expect(state).toEqual([
      {
        key: "fake:inquiry",
        policy: { limit: 3, windowMs: 1_000 },
        count: 1,
        windowStartedAt: 0,
        resetAt: 1_000,
      },
    ]);
  });

  it("blocked checks do not increment state", async () => {
    const limiter = new InMemoryRateLimiter(() => 0);
    const policy = { limit: 1, windowMs: 1_000 };
    await limiter.check("fake:inquiry", policy);
    await limiter.check("fake:inquiry", policy);
    await limiter.check("fake:inquiry", policy);

    expect(limiter.getState()[0]?.count).toBe(1);
  });

  it("reset clears all policy counters", async () => {
    const limiter = new InMemoryRateLimiter(() => 0);
    await limiter.check("fake:one", { limit: 1, windowMs: 1_000 });
    await limiter.check("fake:two", { limit: 2, windowMs: 2_000 });

    limiter.reset();

    expect(limiter.getState()).toEqual([]);
    await expect(
      limiter.check("fake:one", { limit: 1, windowMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("rejects an invalid injected clock safely", async () => {
    const limiter = new InMemoryRateLimiter(() => -1);
    await expect(
      limiter.check("fake:key", { limit: 1, windowMs: 1_000 }),
    ).rejects.toThrow(RangeError);
  });
});
