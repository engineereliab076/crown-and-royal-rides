import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/server/db/prisma";
import { getIntegrationContainer } from "@/server/integrations/container";
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

const LOCAL_HASH_SECRET_FALLBACK =
  "crown-and-royal-rides:auth-rate-limit:local-development-fallback";

/**
 * Resolve the secret used to HMAC rate-limit identifiers. When the real
 * (shared) rate-limit backend is active, a genuine `IP_HASH_SECRET` is
 * mandatory so raw emails/IPs are never derivable from stored keys. With the
 * in-memory limiter (local/test) keys never leave the process, so a fixed
 * non-secret fallback is acceptable.
 */
function resolveHashSecret(usesSharedBackend: boolean): string {
  const secret = env.IP_HASH_SECRET;
  if (typeof secret === "string" && secret.length >= 32) return secret;
  if (usesSharedBackend) {
    throw new Error(
      "IP_HASH_SECRET (at least 32 characters) is required to hash " +
        "authentication rate-limit identifiers when a shared rate-limit " +
        "backend is configured.",
    );
  }
  return LOCAL_HASH_SECRET_FALLBACK;
}

let singleton: AuthServices | undefined;

function build(): AuthServices {
  const repository = createPrismaAuthRepository(prisma);
  const authService = createAuthService({ repository });

  const container = getIntegrationContainer();
  const usesSharedBackend =
    container.mode.providers.rateLimiter !== "in-memory";
  const authRateLimiter = createAuthRateLimiter({
    rateLimiter: container.rateLimiter,
    hashSecret: resolveHashSecret(usesSharedBackend),
  });

  return Object.freeze({ authService, authRateLimiter });
}

export function getAuthServices(): AuthServices {
  singleton ??= build();
  return singleton;
}
