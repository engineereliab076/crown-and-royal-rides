import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEnv, type Environment } from "@/lib/env.schema";
import {
  createIntegrationContainer,
  getIntegrationContainer,
  resetIntegrationContainerForTests,
  type IntegrationContainerDependencies,
} from "@/server/integrations/container";
import { InMemoryEmailSender } from "@/server/integrations/email-sender/in-memory";
import { ResendEmailSender } from "@/server/integrations/email-sender/resend";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import { SentryErrorReporter } from "@/server/integrations/error-reporter/sentry";
import { CloudinaryMediaStorage } from "@/server/integrations/media-storage/cloudinary";
import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import { UpstashRateLimiter } from "@/server/integrations/rate-limiter/upstash";

function providerGroups(environment: "dev" | "preview" | "prod") {
  const deployed = environment !== "dev";
  const sentryEnvironment =
    environment === "prod"
      ? "production"
      : environment === "dev"
        ? "development"
        : "preview";
  return {
    ...(deployed
      ? {
          VERCEL_ENV: environment === "prod" ? "production" : "preview",
          NEXT_PUBLIC_APP_URL: "https://app.example.test",
          APP_ORIGIN: "https://app.example.test",
        }
      : {}),
    CLOUDINARY_CLOUD_NAME: "demo-cloud",
    CLOUDINARY_API_KEY: "fake-cloudinary-key",
    CLOUDINARY_API_SECRET: "fake-cloudinary-secret",
    CLOUDINARY_FOLDER_PREFIX: environment,
    RESEND_API_KEY: "re_fake_key",
    EMAIL_FROM: "no-reply@example.test",
    INQUIRY_NOTIFICATION_FALLBACK: "fallback@example.test",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token",
    RATE_LIMIT_NAMESPACE: `${environment === "prod" ? "prod" : environment}:`,
    SENTRY_DSN: "https://public-key@sentry.example.test/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://public-key@sentry.example.test/1",
    SENTRY_ENVIRONMENT: sentryEnvironment,
  };
}

function fakeDependencies(): IntegrationContainerDependencies {
  return {
    cloudinary: {
      sign: vi.fn(() => "0".repeat(40)),
      destroy: vi.fn(async () => ({ result: "ok" })),
      resource: vi.fn(async () => ({
        public_id: "dev/vehicles/vehicle/id/asset-id",
        version: 1,
        secure_url:
          "https://res.cloudinary.com/demo-cloud/image/upload/dev/vehicles/vehicle/id/asset-id.jpg",
        width: 1600,
        height: 900,
        bytes: 1000,
        format: "jpg",
        resource_type: "image",
        created_at: "2026-01-01T00:00:00.000Z",
      })),
      url: vi.fn(
        (publicId) =>
          `https://res.cloudinary.com/demo-cloud/image/upload/${publicId}`,
      ),
    },
    resend: {
      send: vi.fn(async () => ({ data: { id: "email-1" }, error: null })),
    },
    upstashLimiterFactory: vi.fn(({ limit, windowMs }) => ({
      limit: vi.fn(async () => ({
        success: true,
        limit,
        remaining: limit - 1,
        reset: windowMs,
      })),
    })),
    sentry: {
      withIsolationScope: vi.fn((callback) =>
        callback({ setTag: vi.fn(), setContext: vi.fn() }),
      ),
      captureException: vi.fn(),
      captureMessage: vi.fn(),
    },
  };
}

describe("integration composition root", () => {
  beforeEach(() => resetIntegrationContainerForTests());

  it("selects only in-memory adapters in NODE_ENV=test", () => {
    const dependencies = fakeDependencies();
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "test", ...providerGroups("dev") }),
      dependencies,
    );

    expect(container.mediaStorage).toBeInstanceOf(InMemoryMediaStorage);
    expect(container.emailSender).toBeInstanceOf(InMemoryEmailSender);
    expect(container.rateLimiter).toBeInstanceOf(InMemoryRateLimiter);
    expect(container.errorReporter).toBeInstanceOf(InMemoryErrorReporter);
    expect(container.mode).toEqual({
      deployment: "test",
      providers: {
        mediaStorage: "in-memory",
        emailSender: "in-memory",
        rateLimiter: "in-memory",
        errorReporter: "in-memory",
      },
    });
    expect(dependencies.upstashLimiterFactory).not.toHaveBeenCalled();
    expect(dependencies.cloudinary?.sign).not.toHaveBeenCalled();
    expect(dependencies.resend?.send).not.toHaveBeenCalled();
    expect(dependencies.sentry?.captureException).not.toHaveBeenCalled();
  });

  it("uses safe doubles in local development when provider groups are absent", () => {
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "development" }),
    );
    expect(container.mediaStorage).toBeInstanceOf(InMemoryMediaStorage);
    expect(container.emailSender).toBeInstanceOf(InMemoryEmailSender);
    expect(container.rateLimiter).toBeInstanceOf(InMemoryRateLimiter);
    expect(container.errorReporter).toBeInstanceOf(InMemoryErrorReporter);
    expect(container.mode.deployment).toBe("local");
  });

  it("selects real adapter classes locally with complete fake groups", () => {
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "development", ...providerGroups("dev") }),
      fakeDependencies(),
    );
    expect(container.mediaStorage).toBeInstanceOf(CloudinaryMediaStorage);
    expect(container.emailSender).toBeInstanceOf(ResendEmailSender);
    expect(container.rateLimiter).toBeInstanceOf(UpstashRateLimiter);
    expect(container.errorReporter).toBeInstanceOf(SentryErrorReporter);
    expect(container.mode.providers).toEqual({
      mediaStorage: "cloudinary",
      emailSender: "resend",
      rateLimiter: "upstash",
      errorReporter: "sentry",
    });
  });

  it("leaves partial-group rejection to the environment parser", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "development", RESEND_API_KEY: "re_fake" }),
    ).toThrow(/EMAIL_FROM/);
  });

  it.each(["preview", "production"] as const)(
    "constructs without throwing, then fails safely per requested provider in %s",
    (vercelEnvironment) => {
      const environment = parseEnv({
        NODE_ENV: "production",
        VERCEL_ENV: vercelEnvironment,
        NEXT_PUBLIC_APP_URL: "https://app.example.test",
        APP_ORIGIN: "https://app.example.test",
      });
      // Construction (what importing a route module does) no longer throws...
      const container = createIntegrationContainer(environment);
      // ...but requesting each unconfigured integration fails safely, and never
      // silently substitutes an in-memory adapter in a deployed environment.
      expect(() => container.mediaStorage).toThrow(/CLOUDINARY_CLOUD_NAME/);
      expect(() => container.emailSender).toThrow(/RESEND_API_KEY/);
      expect(() => container.rateLimiter).toThrow(/UPSTASH_REDIS_REST_URL/);
      expect(() => container.errorReporter).toThrow(/SENTRY_DSN/);
    },
  );

  it.each([
    ["preview", "preview"],
    ["production", "prod"],
  ] as const)("selects all real adapters in %s", (_label, folder) => {
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "production", ...providerGroups(folder) }),
      fakeDependencies(),
    );
    expect(container.mode.providers).toEqual({
      mediaStorage: "cloudinary",
      emailSender: "resend",
      rateLimiter: "upstash",
      errorReporter: "sentry",
    });
  });

  it("never includes supplied secret values in factory errors or descriptors", () => {
    const marker = "SECRET_MARKER_MUST_NOT_LEAK";
    const partial: Environment = {
      ...parseEnv({ NODE_ENV: "development" }),
      CLOUDINARY_API_SECRET: marker,
    };
    expect(() => createIntegrationContainer(partial)).toThrow(
      /CLOUDINARY_CLOUD_NAME/,
    );
    try {
      createIntegrationContainer(partial);
    } catch (error) {
      expect(String(error)).not.toContain(marker);
    }
    expect(
      JSON.stringify(
        createIntegrationContainer(parseEnv({ NODE_ENV: "development" })).mode,
      ),
    ).not.toContain(marker);
  });

  it("reuses the lazy process singleton and supports a test-only reset", () => {
    const first = getIntegrationContainer();
    expect(getIntegrationContainer()).toBe(first);
    resetIntegrationContainerForTests();
    expect(getIntegrationContainer()).not.toBe(first);
  });
});

// The production deployment carries database + auth vars and Upstash + Sentry,
// but not Cloudinary or Resend (media/email features do not exist yet). These
// tests pin the lazy, independent resolution that lets an admin route import and
// collect page data during `next build` without those unrelated credentials.
describe("integration composition root — lazy independent resolution", () => {
  const DEPLOYED_BASE = {
    NODE_ENV: "production" as const,
    VERCEL_ENV: "production" as const,
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    APP_ORIGIN: "https://app.example.test",
  };
  const UPSTASH = {
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token",
    RATE_LIMIT_NAMESPACE: "prod:",
  };
  const SENTRY = {
    SENTRY_DSN: "https://public-key@sentry.example.test/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://public-key@sentry.example.test/1",
    SENTRY_ENVIRONMENT: "production" as const,
  };

  it("resolves the error reporter without initializing Cloudinary, Resend, or Upstash", () => {
    const container = createIntegrationContainer(
      parseEnv({ ...DEPLOYED_BASE, ...SENTRY }),
      fakeDependencies(),
    );

    expect(container.errorReporter).toBeInstanceOf(SentryErrorReporter);
    // The other providers were never touched — requesting them still fails
    // (they are unconfigured), proving the error reporter did not initialize them.
    expect(() => container.mediaStorage).toThrow(/CLOUDINARY_CLOUD_NAME/);
    expect(() => container.emailSender).toThrow(/RESEND_API_KEY/);
    expect(() => container.rateLimiter).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("resolves the rate limiter without initializing Cloudinary or Resend", () => {
    const container = createIntegrationContainer(
      parseEnv({ ...DEPLOYED_BASE, ...UPSTASH }),
      fakeDependencies(),
    );

    expect(container.rateLimiter).toBeInstanceOf(UpstashRateLimiter);
    expect(() => container.mediaStorage).toThrow(/CLOUDINARY_CLOUD_NAME/);
    expect(() => container.emailSender).toThrow(/RESEND_API_KEY/);
  });

  it("supports admin/audit/settings construction (rate limiter + error reporter) without Cloudinary or Resend", () => {
    const container = createIntegrationContainer(
      parseEnv({ ...DEPLOYED_BASE, ...UPSTASH, ...SENTRY }),
      fakeDependencies(),
    );

    // What the admin/auth composition roots actually read:
    expect(container.mode.providers.rateLimiter).toBe("upstash");
    expect(container.rateLimiter).toBeInstanceOf(UpstashRateLimiter);
    expect(container.errorReporter).toBeInstanceOf(SentryErrorReporter);
    // Media/email stay uninitialized and unconfigured.
    expect(() => container.mediaStorage).toThrow(/CLOUDINARY_CLOUD_NAME/);
    expect(() => container.emailSender).toThrow(/RESEND_API_KEY/);
  });

  it("never falls back to an in-memory adapter for a missing provider in production", () => {
    const container = createIntegrationContainer(
      parseEnv({ ...DEPLOYED_BASE, ...UPSTASH, ...SENTRY }),
      fakeDependencies(),
    );
    // A deployed environment must fail rather than silently degrade.
    expect(() => container.mediaStorage).toThrow(
      /Real integrations are required in production/,
    );
    expect(() => container.emailSender).toThrow(
      /Real integrations are required in production/,
    );
  });

  it("memoizes each lazily created provider (singleton per container)", () => {
    const container = createIntegrationContainer(
      parseEnv({ NODE_ENV: "development", ...providerGroups("dev") }),
      fakeDependencies(),
    );
    expect(container.mediaStorage).toBe(container.mediaStorage);
    expect(container.emailSender).toBe(container.emailSender);
    expect(container.rateLimiter).toBe(container.rateLimiter);
    expect(container.errorReporter).toBe(container.errorReporter);
  });
});
