import "server-only";

import { createHmac } from "node:crypto";

import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type { RateLimitPolicy } from "@/server/integrations/rate-limiter/types";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const ADMIN_PASSWORD_RESET_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: FIFTEEN_MINUTES_MS,
};

export interface AdministratorRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

export interface AdministratorRateLimiter {
  checkPasswordReset(input: {
    actorId: string;
    targetId: string;
  }): Promise<AdministratorRateLimitDecision>;
}

function hashIdentifier(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createAdministratorRateLimiter(input: {
  readonly rateLimiter: RateLimiter;
  readonly hashSecret: string;
}): AdministratorRateLimiter {
  if (input.hashSecret.length === 0) {
    throw new TypeError("Administrator rate limiter requires a hash secret.");
  }

  return {
    async checkPasswordReset({ actorId, targetId }) {
      const digest = hashIdentifier(
        input.hashSecret,
        `actor:${actorId}:target:${targetId}`,
      );
      try {
        const result = await input.rateLimiter.check(
          `admin:password-reset:${digest}`,
          ADMIN_PASSWORD_RESET_POLICY,
        );
        return result.allowed
          ? { allowed: true }
          : {
              allowed: false,
              ...(result.retryAfterMs === undefined
                ? {}
                : { retryAfterMs: result.retryAfterMs }),
            };
      } catch {
        // Password operations fail closed when the provider is unavailable.
        return { allowed: false };
      }
    },
  };
}
