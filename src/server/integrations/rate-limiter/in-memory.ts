import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type {
  RateLimitPolicy,
  RateLimitResult,
} from "@/server/integrations/rate-limiter/types";
import {
  normalizeRateLimitKey,
  normalizeRateLimitPolicy,
} from "@/server/integrations/rate-limiter/validation";

export interface RateLimitStateSnapshot {
  readonly key: string;
  readonly policy: Readonly<RateLimitPolicy>;
  readonly count: number;
  readonly windowStartedAt: number;
  readonly resetAt: number;
}

interface CounterState {
  readonly key: string;
  readonly policy: Readonly<RateLimitPolicy>;
  count: number;
  windowStartedAt: number;
}

function readClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Rate-limiter clock must return a safe timestamp.");
  }

  return value;
}

function identity(key: string, policy: RateLimitPolicy): string {
  return `${key.length}:${key}:${policy.limit}:${policy.windowMs}`;
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly #now: () => number;
  readonly #counters = new Map<string, CounterState>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const normalizedKey = normalizeRateLimitKey(key);
    const normalizedPolicy = normalizeRateLimitPolicy(policy);
    const timestamp = readClock(this.#now);
    const windowStartedAt =
      Math.floor(timestamp / normalizedPolicy.windowMs) *
      normalizedPolicy.windowMs;
    const counterKey = identity(normalizedKey, normalizedPolicy);
    let state = this.#counters.get(counterKey);

    if (state === undefined || state.windowStartedAt !== windowStartedAt) {
      state = {
        key: normalizedKey,
        policy: normalizedPolicy,
        count: 0,
        windowStartedAt,
      };
      this.#counters.set(counterKey, state);
    }

    const allowed = state.count < normalizedPolicy.limit;
    if (allowed) state.count += 1;

    const resetAt = windowStartedAt + normalizedPolicy.windowMs;
    if (!Number.isSafeInteger(resetAt)) {
      throw new RangeError("Rate-limit reset must be a safe timestamp.");
    }
    const remaining = Math.max(normalizedPolicy.limit - state.count, 0);

    return Object.freeze({
      allowed,
      limit: normalizedPolicy.limit,
      remaining,
      resetAt,
      ...(allowed ? {} : { retryAfterMs: resetAt - timestamp }),
    });
  }

  getState(): ReadonlyArray<RateLimitStateSnapshot> {
    return Object.freeze(
      [...this.#counters.values()].map((state) =>
        Object.freeze({
          key: state.key,
          policy: Object.freeze({ ...state.policy }),
          count: state.count,
          windowStartedAt: state.windowStartedAt,
          resetAt: state.windowStartedAt + state.policy.windowMs,
        }),
      ),
    );
  }

  reset(): void {
    this.#counters.clear();
  }
}
