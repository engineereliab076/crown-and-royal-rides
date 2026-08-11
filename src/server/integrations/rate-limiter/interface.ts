import type {
  RateLimitPolicy,
  RateLimitResult,
} from "@/server/integrations/rate-limiter/types";

export interface RateLimiter {
  /**
   * Uses fixed windows. An allowed check consumes one allowance; blocked checks
   * do not. A check at exactly resetAt starts a new window.
   */
  check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
}
