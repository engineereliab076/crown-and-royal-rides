import { describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/lib/env.schema";
import {
  AuthRateLimiterConfigurationError,
  buildAuthRateLimiter,
  missingRateLimiterConfig,
  type RateLimiterEnvView,
} from "@/server/auth/services";
import {
  createIntegrationContainer,
  type IntegrationContainerDependencies,
} from "@/server/integrations/container";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";

/**
 * A Production-shaped environment with the three Upstash variables present and a
 * valid `prod:` namespace — i.e. exactly what the reported production deployment
 * has. `IP_HASH_SECRET` is included by default (the shared limiter needs it);
 * tests omit it to reproduce the real, previously-misdiagnosed failure.
 */
function productionEnvInput(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    APP_ORIGIN: "https://app.example.test",
    AUTH_SECRET: "auth-secret-value-of-at-least-32-characters",
    AUTH_URL: "https://app.example.test",
    IP_HASH_SECRET: "ip-hash-secret-of-at-least-32-characters!",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token",
    RATE_LIMIT_NAMESPACE: "prod:",
    ...overrides,
  };
}

function fakeDependencies(): IntegrationContainerDependencies {
  return {
    upstashLimiterFactory: vi.fn(({ limit, windowMs }) => ({
      limit: vi.fn(async () => ({
        success: true,
        limit,
        remaining: limit - 1,
        reset: windowMs,
      })),
    })),
  };
}

function productionContainer(
  overrides: Record<string, string | undefined> = {},
) {
  return createIntegrationContainer(
    parseEnv(productionEnvInput(overrides)),
    fakeDependencies(),
  );
}

function envView(
  overrides: Partial<RateLimiterEnvView> = {},
): RateLimiterEnvView {
  return {
    upstashUrl: "https://redis.example.test",
    upstashToken: "fake-upstash-token",
    namespace: "prod:",
    ipHashSecret: "ip-hash-secret-of-at-least-32-characters!",
    ...overrides,
  };
}

describe("buildAuthRateLimiter — production configuration path", () => {
  it("constructs the real Upstash-backed limiter when all variables are present", () => {
    const container = productionContainer();
    // The container itself selects the real Upstash provider for prod values.
    expect(container.mode.providers.rateLimiter).toBe("upstash");

    const limiter = buildAuthRateLimiter(container, envView());

    // A usable limiter was built (no fail-closed configuration error), so the
    // three Production Upstash variables are correctly recognized as present.
    expect(typeof limiter.checkLoginIp).toBe("function");
    expect(typeof limiter.recordLoginFailure).toBe("function");
  });

  it("reports IP_HASH_SECRET (not the Upstash vars) when only it is absent", () => {
    const container = productionContainer();
    let caught: AuthRateLimiterConfigurationError | undefined;
    try {
      buildAuthRateLimiter(container, envView({ ipHashSecret: undefined }));
    } catch (error) {
      caught = error as AuthRateLimiterConfigurationError;
    }
    expect(caught).toBeInstanceOf(AuthRateLimiterConfigurationError);
    expect(caught?.missing).toEqual(["IP_HASH_SECRET"]);
  });

  it("names a genuinely absent Upstash variable", () => {
    const container = productionContainer();
    let caught: AuthRateLimiterConfigurationError | undefined;
    try {
      buildAuthRateLimiter(container, envView({ upstashToken: undefined }));
    } catch (error) {
      caught = error as AuthRateLimiterConfigurationError;
    }
    expect(caught?.missing).toContain("UPSTASH_REDIS_REST_TOKEN");
  });

  it("uses the in-memory backend locally without requiring shared config", () => {
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "development" }),
    );
    expect(container.mode.providers.rateLimiter).toBe("in-memory");
    expect(container.rateLimiter).toBeInstanceOf(InMemoryRateLimiter);

    const limiter = buildAuthRateLimiter(container, {
      upstashUrl: undefined,
      upstashToken: undefined,
      namespace: undefined,
      ipHashSecret: undefined,
    });
    expect(typeof limiter.checkLoginIp).toBe("function");
  });
});

describe("missingRateLimiterConfig", () => {
  it("returns nothing when the shared backend is not required", () => {
    expect(
      missingRateLimiterConfig({
        requiresSharedBackend: false,
        env: {
          upstashUrl: undefined,
          upstashToken: undefined,
          namespace: undefined,
          ipHashSecret: undefined,
        },
      }),
    ).toEqual([]);
  });

  it("returns nothing when every shared variable is present and usable", () => {
    expect(
      missingRateLimiterConfig({ requiresSharedBackend: true, env: envView() }),
    ).toEqual([]);
  });

  it("flags a too-short IP_HASH_SECRET the same as an absent one", () => {
    expect(
      missingRateLimiterConfig({
        requiresSharedBackend: true,
        env: envView({ ipHashSecret: "too-short" }),
      }),
    ).toEqual(["IP_HASH_SECRET"]);
  });

  it("lists every absent shared variable by name", () => {
    expect(
      missingRateLimiterConfig({
        requiresSharedBackend: true,
        env: {
          upstashUrl: undefined,
          upstashToken: undefined,
          namespace: undefined,
          ipHashSecret: undefined,
        },
      }),
    ).toEqual([
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "RATE_LIMIT_NAMESPACE",
      "IP_HASH_SECRET",
    ]);
  });

  it("never includes a variable value, only its name", () => {
    const missing = missingRateLimiterConfig({
      requiresSharedBackend: true,
      env: envView({ ipHashSecret: undefined }),
    });
    expect(JSON.stringify(missing)).not.toContain("fake-upstash-token");
    expect(JSON.stringify(missing)).not.toContain("redis.example.test");
  });
});
