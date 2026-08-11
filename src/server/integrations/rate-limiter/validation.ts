import type { RateLimitPolicy } from "@/server/integrations/rate-limiter/types";

export function normalizeRateLimitKey(key: string): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("Rate-limit key must be a non-empty string.");
  }

  return key.trim();
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }

  return value;
}

export function normalizeRateLimitPolicy(
  policy: RateLimitPolicy,
): Readonly<RateLimitPolicy> {
  if (typeof policy !== "object" || policy === null) {
    throw new TypeError("Rate-limit policy must be an object.");
  }

  return Object.freeze({
    limit: positiveSafeInteger(policy.limit, "limit"),
    windowMs: positiveSafeInteger(policy.windowMs, "windowMs"),
  });
}
