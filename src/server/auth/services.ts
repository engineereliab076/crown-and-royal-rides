import "server-only";

import { env } from "@/lib/env";
import type { DiagnosticConfigVariable } from "@/server/diagnostics/events";
import { prisma } from "@/server/db/prisma";
import {
  getIntegrationContainer,
  type IntegrationContainer,
} from "@/server/integrations/container";
import {
  type AuthRateLimiter,
  createAuthRateLimiter,
} from "@/server/modules/auth/rate-limit";
import { createPrismaAuthRepository } from "@/server/modules/auth/repository";
import {
  type AuthService,
  createAuthService,
} from "@/server/modules/auth/service";

/**
 * Composition root for the authentication services.
 *
 * This is the single place that binds the Prisma singleton and the integration
 * container's `RateLimiter` to the auth repository, service, and rate limiter.
 * It reads the environment only to obtain the identifier-hashing secret; the
 * business modules themselves never touch `process.env`.
 */

export interface AuthServices {
  readonly authService: AuthService;
  readonly authRateLimiter: AuthRateLimiter;
}

/**
 * Safe setup failure for the fail-closed authentication limiter. Carries the
 * *names* of any absent configuration variables (never their values) so the
 * diagnostic can name the real gap instead of a generic "missing" code.
 */
export class AuthRateLimiterConfigurationError extends Error {
  readonly code = "AUTH_RATE_LIMITER_CONFIGURATION";
  readonly missing: readonly DiagnosticConfigVariable[];

  constructor(missing: readonly DiagnosticConfigVariable[] = []) {
    super("Authentication rate limiting is unavailable or misconfigured.");
    this.name = "AuthRateLimiterConfigurationError";
    this.missing = Object.freeze([...missing]);
  }
}

const LOCAL_HASH_SECRET_FALLBACK =
  "crown-and-royal-rides:auth-rate-limit:local-development-fallback";

const MIN_HASH_SECRET_LENGTH = 32;

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableHashSecret(value: string | undefined): boolean {
  return typeof value === "string" && value.length >= MIN_HASH_SECRET_LENGTH;
}

/** A safe, value-free view of the rate-limiter configuration. */
export interface RateLimiterEnvView {
  readonly upstashUrl: string | undefined;
  readonly upstashToken: string | undefined;
  readonly namespace: string | undefined;
  readonly ipHashSecret: string | undefined;
}

/**
 * Names of the rate-limiter configuration variables that are absent or unusable
 * when a shared (Upstash) backend is required. Returns an empty list for the
 * in-memory backend (local/test), which needs no shared configuration.
 *
 * This exists because the shared limiter depends on the three Upstash variables
 * *and* on `IP_HASH_SECRET` (used to HMAC identifiers); the environment schema
 * does not require `IP_HASH_SECRET`, so an otherwise-valid deployment can reach
 * here missing only that one variable. Listing the exact name prevents the
 * failure from being misread as "Upstash missing".
 */
export function missingRateLimiterConfig(input: {
  readonly requiresSharedBackend: boolean;
  readonly env: RateLimiterEnvView;
}): readonly DiagnosticConfigVariable[] {
  if (!input.requiresSharedBackend) return [];
  const missing: DiagnosticConfigVariable[] = [];
  if (!isPresent(input.env.upstashUrl)) missing.push("UPSTASH_REDIS_REST_URL");
  if (!isPresent(input.env.upstashToken)) {
    missing.push("UPSTASH_REDIS_REST_TOKEN");
  }
  if (!isPresent(input.env.namespace)) missing.push("RATE_LIMIT_NAMESPACE");
  if (!isUsableHashSecret(input.env.ipHashSecret)) {
    missing.push("IP_HASH_SECRET");
  }
  return missing;
}

/**
 * Resolve the secret used to HMAC rate-limit identifiers. When the real
 * (shared) rate-limit backend is active, a genuine `IP_HASH_SECRET` is
 * mandatory so raw emails/IPs are never derivable from stored keys. With the
 * in-memory limiter (local/test) keys never leave the process, so a fixed
 * non-secret fallback is acceptable.
 */
function resolveHashSecret(
  usesSharedBackend: boolean,
  ipHashSecret: string | undefined,
): string {
  if (isUsableHashSecret(ipHashSecret)) return ipHashSecret as string;
  if (usesSharedBackend) {
    throw new AuthRateLimiterConfigurationError(["IP_HASH_SECRET"]);
  }
  return LOCAL_HASH_SECRET_FALLBACK;
}

/**
 * Assemble the fail-closed authentication rate limiter for a resolved container
 * and a value-free environment view. Throws {@link AuthRateLimiterConfigurationError}
 * with the exact missing variable names when the shared backend cannot be
 * configured. Extracted so the configuration path is unit-testable with a
 * production-shaped environment.
 */
export function buildAuthRateLimiter(
  container: IntegrationContainer,
  envView: RateLimiterEnvView,
): AuthRateLimiter {
  const deployment = container.mode.deployment;
  const providerIsUpstash =
    container.mode.providers.rateLimiter !== "in-memory";
  const isDeployed = deployment === "preview" || deployment === "production";
  const requiresSharedBackend = providerIsUpstash || isDeployed;

  const missing = missingRateLimiterConfig({
    requiresSharedBackend,
    env: envView,
  });
  if (missing.length > 0) {
    throw new AuthRateLimiterConfigurationError(missing);
  }

  try {
    return createAuthRateLimiter({
      rateLimiter: container.rateLimiter,
      hashSecret: resolveHashSecret(providerIsUpstash, envView.ipHashSecret),
    });
  } catch (error) {
    if (error instanceof AuthRateLimiterConfigurationError) throw error;
    // An unexpected construction failure with no identifiable missing variable.
    throw new AuthRateLimiterConfigurationError([]);
  }
}

let singleton: AuthServices | undefined;

function build(): AuthServices {
  const repository = createPrismaAuthRepository(prisma);
  const authService = createAuthService({ repository });

  let container: IntegrationContainer;
  try {
    container = getIntegrationContainer();
  } catch {
    // Container composition failed for a reason we cannot safely attribute to a
    // specific variable (e.g. an unrelated integration group).
    throw new AuthRateLimiterConfigurationError([]);
  }

  const authRateLimiter = buildAuthRateLimiter(container, {
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    namespace: env.RATE_LIMIT_NAMESPACE,
    ipHashSecret: env.IP_HASH_SECRET,
  });

  return Object.freeze({ authService, authRateLimiter });
}

export function getAuthServices(): AuthServices {
  singleton ??= build();
  return singleton;
}
