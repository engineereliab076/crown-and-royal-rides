import "server-only";

import { createHmac } from "node:crypto";

import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type { RateLimitPolicy } from "@/server/integrations/rate-limiter/types";
import { normalizeEmail } from "@/server/modules/auth/schemas";

/**
 * Authentication rate limiting.
 *
 * `RateLimiter.check` is a *consuming* operation — each call spends one
 * fixed-window allowance — so the two login axes are consumed at deliberately
 * different points:
 *
 * - **IP** ({@link checkLoginIp}) is consumed once per login attempt, before the
 *   expensive Argon2 verification, so it bounds all attempts (success or not).
 * - **Email** ({@link recordLoginFailure}) is consumed only *after* a failed
 *   credential verification, so a successful login never spends an email
 *   allowance. Five failures on one normalized email exhaust the window and the
 *   sixth is locked out.
 *
 * Password changes are throttled per authenticated administrator. Only the
 * {@link RateLimiter} interface is used (never a provider SDK), and every
 * identifier is HMAC-hashed with the application hash secret before it becomes
 * part of a key, so no raw email or IP is ever stored in the limiter backend.
 *
 * Policy on provider failure is **fail-closed**: if the limiter throws, the
 * attempt is denied rather than allowed, preserving brute-force protection.
 */

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Five failed attempts per email per window trigger a temporary lockout. */
export const LOGIN_EMAIL_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: FIFTEEN_MINUTES_MS,
};

/** A broader per-IP ceiling catches distributed guessing across accounts. */
export const LOGIN_IP_POLICY: RateLimitPolicy = {
  limit: 20,
  windowMs: FIFTEEN_MINUTES_MS,
};

/** Password changes are throttled per authenticated administrator. */
export const PASSWORD_CHANGE_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: FIFTEEN_MINUTES_MS,
};

export type RateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "limited";
      readonly retryAfterMs?: number;
    }
  | { readonly allowed: false; readonly reason: "unavailable" };

export interface AuthRateLimiterDependencies {
  readonly rateLimiter: RateLimiter;
  /** Secret used to HMAC identifiers (the application `IP_HASH_SECRET`). */
  readonly hashSecret: string;
}

export interface AuthRateLimiter {
  /**
   * Consume the per-IP allowance for a login attempt. Called before Argon2
   * verification so it bounds every attempt regardless of outcome. A `null` IP
   * (unknown client) cannot be throttled and is allowed through.
   */
  checkLoginIp(ip: string | null): Promise<RateLimitDecision>;
  /**
   * Consume the per-email allowance for a *failed* login. Called only after a
   * credential verification fails, so successful logins never spend it. The
   * returned decision is `allowed: false` once the account is locked out.
   */
  recordLoginFailure(email: string): Promise<RateLimitDecision>;
  checkPasswordChange(input: { adminId: string }): Promise<RateLimitDecision>;
}

function hashIdentifier(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createAuthRateLimiter(
  deps: AuthRateLimiterDependencies,
): AuthRateLimiter {
  const { rateLimiter, hashSecret } = deps;
  if (typeof hashSecret !== "string" || hashSecret.length === 0) {
    throw new TypeError("Auth rate limiter requires a non-empty hash secret.");
  }

  function keyFor(scope: string, value: string): string {
    return `auth:${scope}:${hashIdentifier(hashSecret, value)}`;
  }

  async function guard(
    scope: string,
    value: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    try {
      const result = await rateLimiter.check(keyFor(scope, value), policy);
      if (result.allowed) return { allowed: true };
      return result.retryAfterMs === undefined
        ? { allowed: false, reason: "limited" }
        : {
            allowed: false,
            reason: "limited",
            retryAfterMs: result.retryAfterMs,
          };
    } catch {
      // Fail-closed, but preserve the safe distinction from a real lockout.
      return { allowed: false, reason: "unavailable" };
    }
  }

  return {
    async checkLoginIp(ip: string | null) {
      if (ip === null || ip.length === 0) return { allowed: true };
      return guard("login:ip", ip, LOGIN_IP_POLICY);
    },

    async recordLoginFailure(email: string) {
      return guard("login:email", normalizeEmail(email), LOGIN_EMAIL_POLICY);
    },

    async checkPasswordChange({ adminId }: { adminId: string }) {
      return guard("pwchange:admin", adminId, PASSWORD_CHANGE_POLICY);
    },
  };
}
