import "server-only";

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { IntegrationUnavailableError } from "@/server/integrations/errors";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type {
  RateLimitPolicy,
  RateLimitResult,
} from "@/server/integrations/rate-limiter/types";
import {
  normalizeRateLimitKey,
  normalizeRateLimitPolicy,
} from "@/server/integrations/rate-limiter/validation";

export interface UpstashRateLimiterConfig {
  readonly restUrl: string;
  readonly restToken: string;
  readonly namespace: string;
  readonly maxPolicies?: number;
}

export interface UpstashLimitResponse {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
}

export interface UpstashLimiterFacade {
  limit(identifier: string): Promise<UpstashLimitResponse>;
}

export interface UpstashLimiterFactoryInput {
  readonly limit: number;
  readonly windowMs: number;
  readonly namespace: string;
}

export type UpstashLimiterFactory = (
  input: UpstashLimiterFactoryInput,
) => UpstashLimiterFacade;

const DEFAULT_MAX_POLICIES = 32;

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function readClock(now: () => number): number {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("Rate-limiter clock must return a safe timestamp.");
  }
  return timestamp;
}

function createDefaultFactory(config: {
  restUrl: string;
  restToken: string;
}): UpstashLimiterFactory {
  const redis = new Redis({ url: config.restUrl, token: config.restToken });

  return ({ limit, windowMs, namespace }): UpstashLimiterFacade => {
    const duration: Duration = `${windowMs} ms`;
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(limit, duration),
      analytics: false,
      prefix: `${namespace}ratelimit:${limit}:${windowMs}`,
    });
    return { limit: (identifier) => limiter.limit(identifier) };
  };
}

function cacheIdentity(namespace: string, policy: RateLimitPolicy): string {
  return `${namespace.length}:${namespace}:${policy.limit}:${policy.windowMs}`;
}

function validProviderResponse(
  response: UpstashLimitResponse,
  policy: RateLimitPolicy,
): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    typeof response.success === "boolean" &&
    response.limit === policy.limit &&
    Number.isSafeInteger(response.remaining) &&
    response.remaining >= 0 &&
    response.remaining <= policy.limit &&
    Number.isSafeInteger(response.reset) &&
    response.reset >= 0
  );
}

export class UpstashRateLimiter implements RateLimiter {
  readonly #namespace: string;
  readonly #factory: UpstashLimiterFactory;
  readonly #maxPolicies: number;
  readonly #now: () => number;
  readonly #limiters = new Map<string, UpstashLimiterFacade>();

  constructor(
    config: UpstashRateLimiterConfig,
    factory?: UpstashLimiterFactory,
    now: () => number = Date.now,
  ) {
    if (typeof config !== "object" || config === null) {
      throw new TypeError("Upstash configuration must be an object.");
    }
    const restUrl = required(config.restUrl, "Upstash restUrl");
    const restToken = required(config.restToken, "Upstash restToken");
    this.#namespace = required(config.namespace, "Upstash namespace");
    this.#maxPolicies = positiveSafeInteger(
      config.maxPolicies ?? DEFAULT_MAX_POLICIES,
      "Upstash maxPolicies",
    );
    this.#factory = factory ?? createDefaultFactory({ restUrl, restToken });
    this.#now = now;
  }

  async check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const normalizedKey = normalizeRateLimitKey(key);
    const normalizedPolicy = normalizeRateLimitPolicy(policy);
    const limiter = this.#getLimiter(normalizedPolicy);

    try {
      const response = await limiter.limit(
        `${this.#namespace}${normalizedKey}`,
      );
      if (!validProviderResponse(response, normalizedPolicy)) {
        throw new IntegrationUnavailableError();
      }

      const now = readClock(this.#now);
      return Object.freeze({
        allowed: response.success,
        limit: normalizedPolicy.limit,
        remaining: response.remaining,
        resetAt: response.reset,
        ...(response.success
          ? {}
          : { retryAfterMs: Math.max(response.reset - now, 0) }),
      });
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) throw error;
      throw new IntegrationUnavailableError(error);
    }
  }

  getCachedPolicyCount(): number {
    return this.#limiters.size;
  }

  #getLimiter(policy: Readonly<RateLimitPolicy>): UpstashLimiterFacade {
    const identity = cacheIdentity(this.#namespace, policy);
    const existing = this.#limiters.get(identity);
    if (existing !== undefined) {
      this.#limiters.delete(identity);
      this.#limiters.set(identity, existing);
      return existing;
    }

    let limiter: UpstashLimiterFacade;
    try {
      limiter = this.#factory({
        limit: policy.limit,
        windowMs: policy.windowMs,
        namespace: this.#namespace,
      });
    } catch (error) {
      throw new IntegrationUnavailableError(error);
    }

    if (this.#limiters.size >= this.#maxPolicies) {
      const oldest = this.#limiters.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#limiters.delete(oldest);
    }
    this.#limiters.set(identity, limiter);
    return limiter;
  }
}
