import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnv,
  type EnvironmentInput,
} from "@/lib/env.schema";

// --- Fake, obviously-non-real values -------------------------------------

const AUTH_SECRET = `auth-secret-${"a".repeat(40)}`;
const IP_HASH_SECRET = `ip-hash-secret-${"b".repeat(40)}`;
const CRON_SECRET = `cron-secret-${"c".repeat(40)}`;

// --- Helpers -------------------------------------------------------------

function expectEnvError(input: EnvironmentInput): EnvironmentValidationError {
  try {
    parseEnv(input);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected parseEnv to throw EnvironmentValidationError");
}

function pathsOf(error: EnvironmentValidationError): string[] {
  return error.issues.map((issue) => issue.path);
}

function expectNoMarker(
  error: EnvironmentValidationError,
  marker: string,
): void {
  expect(error.message).not.toContain(marker);
  for (const issue of error.issues) {
    expect(issue.path).not.toContain(marker);
    expect(issue.message).not.toContain(marker);
  }
}

function previewUrls(): EnvironmentInput {
  return {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_APP_URL: "https://preview.example.com",
    APP_ORIGIN: "https://preview.example.com",
  };
}

function productionUrls(): EnvironmentInput {
  return {
    VERCEL_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    APP_ORIGIN: "https://app.example.com",
  };
}

function cloudinaryGroup(folder: string): EnvironmentInput {
  return {
    CLOUDINARY_CLOUD_NAME: "demo-cloud",
    CLOUDINARY_API_KEY: "demo-key",
    CLOUDINARY_API_SECRET: "demo-secret",
    CLOUDINARY_FOLDER_PREFIX: folder,
  };
}

function upstashGroup(namespace: string): EnvironmentInput {
  return {
    UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    UPSTASH_REDIS_REST_TOKEN: "demo-token",
    RATE_LIMIT_NAMESPACE: namespace,
  };
}

function sentryGroup(environment: string): EnvironmentInput {
  return {
    SENTRY_DSN: "https://key@sentry.example.com/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://key@sentry.example.com/2",
    SENTRY_ENVIRONMENT: environment,
  };
}

function validPreview(): EnvironmentInput {
  return {
    ...previewUrls(),
    DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
    DIRECT_DATABASE_URL: "postgresql://user:pw@db.example.com:5432/app",
    AUTH_SECRET,
    AUTH_URL: "https://preview.example.com",
    IP_HASH_SECRET,
    ...cloudinaryGroup("preview"),
    RESEND_API_KEY: "re_demo",
    EMAIL_FROM: "no-reply@example.com",
    INQUIRY_NOTIFICATION_FALLBACK: "fallback@example.com",
    ...upstashGroup("preview:"),
    CRON_SECRET,
    ...sentryGroup("preview"),
  };
}

// --- Local defaults and normalization ------------------------------------

describe("local defaults and normalization", () => {
  it("returns local defaults for empty input and freezes the result", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.VERCEL_ENV).toBeUndefined();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.APP_ORIGIN).toBe("http://localhost:3000");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("normalizes blank and whitespace-only variables to undefined", () => {
    const env = parseEnv({
      AUTH_SECRET: "   ",
      DATABASE_URL: "",
      EMAIL_FROM: "\t",
      CRON_SECRET: "\n  ",
    });
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("does not copy unknown variables into the returned object", () => {
    const env = parseEnv({ TOTALLY_UNKNOWN: "x", ANOTHER_UNKNOWN: "y" });
    expect(Object.keys(env)).not.toContain("TOTALLY_UNKNOWN");
    expect(Object.keys(env)).not.toContain("ANOTHER_UNKNOWN");
  });

  it("accepts a valid explicit local origin", () => {
    const env = parseEnv({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      APP_ORIGIN: "http://localhost:3000",
    });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.APP_ORIGIN).toBe("http://localhost:3000");
  });

  it("rejects mismatched local application origins", () => {
    const error = expectEnvError({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      APP_ORIGIN: "http://localhost:4000",
    });
    expect(pathsOf(error)).toContain("APP_ORIGIN");
  });

  it.each([
    ["path", "https://example.com/path"],
    ["query string", "https://example.com/?q=1"],
    ["fragment", "https://example.com/#section"],
    ["username", "https://user@example.com"],
    ["password", "https://user:pass@example.com"],
  ])("rejects an application URL containing a %s", (_label, value) => {
    const error = expectEnvError({
      NEXT_PUBLIC_APP_URL: value,
      APP_ORIGIN: value,
    });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_APP_URL");
  });
});

// --- Vercel environment and URL security ---------------------------------

describe("vercel environment and URL security", () => {
  it("rejects an invalid NODE_ENV", () => {
    const error = expectEnvError({ NODE_ENV: "staging" });
    expect(pathsOf(error)).toContain("NODE_ENV");
  });

  it("rejects an invalid VERCEL_ENV", () => {
    const error = expectEnvError({ VERCEL_ENV: "local" });
    expect(pathsOf(error)).toContain("VERCEL_ENV");
  });

  it("rejects preview without application URLs", () => {
    const error = expectEnvError({ VERCEL_ENV: "preview" });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_APP_URL");
    expect(pathsOf(error)).toContain("APP_ORIGIN");
  });

  it("rejects production without application URLs", () => {
    const error = expectEnvError({ VERCEL_ENV: "production" });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_APP_URL");
    expect(pathsOf(error)).toContain("APP_ORIGIN");
  });

  it("rejects preview HTTP application URLs", () => {
    const error = expectEnvError({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "http://preview.example.com",
      APP_ORIGIN: "http://preview.example.com",
    });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("rejects production HTTP application URLs", () => {
    const error = expectEnvError({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://app.example.com",
      APP_ORIGIN: "http://app.example.com",
    });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("accepts matching HTTPS preview origins", () => {
    const env = parseEnv(previewUrls());
    expect(env.VERCEL_ENV).toBe("preview");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://preview.example.com");
  });

  it("accepts matching HTTPS production origins", () => {
    const env = parseEnv(productionUrls());
    expect(env.VERCEL_ENV).toBe("production");
    expect(env.APP_ORIGIN).toBe("https://app.example.com");
  });
});

// --- Database group ------------------------------------------------------

describe("database group", () => {
  it("accepts both database URLs absent", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_DATABASE_URL).toBeUndefined();
  });

  it("rejects only DATABASE_URL present", () => {
    const error = expectEnvError({
      DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
    });
    expect(pathsOf(error)).toContain("DIRECT_DATABASE_URL");
  });

  it("rejects only DIRECT_DATABASE_URL present", () => {
    const error = expectEnvError({
      DIRECT_DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
    });
    expect(pathsOf(error)).toContain("DATABASE_URL");
  });

  it("rejects a non-PostgreSQL protocol", () => {
    const error = expectEnvError({
      DATABASE_URL: "mysql://user:pw@db.example.com:3306/app",
      DIRECT_DATABASE_URL: "mysql://user:pw@db.example.com:3306/app",
    });
    expect(pathsOf(error)).toContain("DATABASE_URL");
  });

  it("accepts postgres and postgresql URLs together", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
      DIRECT_DATABASE_URL: "postgresql://user:pw@db.example.com:5432/app",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pw@db.example.com:5432/app");
    expect(env.DIRECT_DATABASE_URL).toBe(
      "postgresql://user:pw@db.example.com:5432/app",
    );
  });
});

// --- Authentication and security secrets ---------------------------------

describe("authentication and security secrets", () => {
  it("accepts the auth group entirely absent", () => {
    const env = parseEnv({});
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.AUTH_URL).toBeUndefined();
  });

  it("rejects a partial auth group", () => {
    const error = expectEnvError({ AUTH_SECRET });
    expect(pathsOf(error)).toContain("AUTH_URL");
  });

  it("rejects a short AUTH_SECRET", () => {
    const error = expectEnvError({
      AUTH_SECRET: "too-short",
      AUTH_URL: "http://localhost:3000",
    });
    expect(pathsOf(error)).toContain("AUTH_SECRET");
  });

  it("rejects a non-HTTP AUTH_URL", () => {
    const error = expectEnvError({
      AUTH_SECRET,
      AUTH_URL: "ftp://localhost:3000",
    });
    expect(pathsOf(error)).toContain("AUTH_URL");
  });

  it("rejects a preview HTTP AUTH_URL", () => {
    const error = expectEnvError({
      ...previewUrls(),
      AUTH_SECRET,
      AUTH_URL: "http://preview.example.com",
    });
    expect(pathsOf(error)).toContain("AUTH_URL");
  });

  it("rejects an AUTH_URL with a different origin", () => {
    const error = expectEnvError({
      AUTH_SECRET,
      AUTH_URL: "http://localhost:4000",
    });
    expect(pathsOf(error)).toContain("AUTH_URL");
  });

  it("accepts a valid matching auth configuration", () => {
    const env = parseEnv({
      AUTH_SECRET,
      AUTH_URL: "http://localhost:3000",
    });
    expect(env.AUTH_SECRET).toBe(AUTH_SECRET);
    expect(env.AUTH_URL).toBe("http://localhost:3000");
  });

  it("rejects a short IP_HASH_SECRET", () => {
    const error = expectEnvError({ IP_HASH_SECRET: "too-short" });
    expect(pathsOf(error)).toContain("IP_HASH_SECRET");
  });

  it("rejects IP_HASH_SECRET equal to AUTH_SECRET", () => {
    const error = expectEnvError({
      AUTH_SECRET,
      AUTH_URL: "http://localhost:3000",
      IP_HASH_SECRET: AUTH_SECRET,
    });
    expect(pathsOf(error)).toContain("IP_HASH_SECRET");
  });

  it("rejects a short CRON_SECRET", () => {
    const error = expectEnvError({ CRON_SECRET: "too-short" });
    expect(pathsOf(error)).toContain("CRON_SECRET");
  });

  it("rejects CRON_SECRET equal to AUTH_SECRET", () => {
    const error = expectEnvError({
      AUTH_SECRET,
      AUTH_URL: "http://localhost:3000",
      CRON_SECRET: AUTH_SECRET,
    });
    expect(pathsOf(error)).toContain("CRON_SECRET");
  });

  it("rejects CRON_SECRET equal to IP_HASH_SECRET", () => {
    const error = expectEnvError({
      IP_HASH_SECRET,
      CRON_SECRET: IP_HASH_SECRET,
    });
    expect(pathsOf(error)).toContain("CRON_SECRET");
  });

  it("accepts three distinct valid security secrets", () => {
    const env = parseEnv({
      AUTH_SECRET,
      AUTH_URL: "http://localhost:3000",
      IP_HASH_SECRET,
      CRON_SECRET,
    });
    expect(env.AUTH_SECRET).toBe(AUTH_SECRET);
    expect(env.IP_HASH_SECRET).toBe(IP_HASH_SECRET);
    expect(env.CRON_SECRET).toBe(CRON_SECRET);
  });
});

// --- Cloudinary group ----------------------------------------------------

describe("cloudinary group", () => {
  it("accepts the entire group absent", () => {
    const env = parseEnv({});
    expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(env.CLOUDINARY_FOLDER_PREFIX).toBeUndefined();
  });

  it.each([
    ["cloud name only", { CLOUDINARY_CLOUD_NAME: "demo-cloud" }],
    [
      "missing API secret",
      {
        CLOUDINARY_CLOUD_NAME: "demo-cloud",
        CLOUDINARY_API_KEY: "demo-key",
        CLOUDINARY_FOLDER_PREFIX: "dev",
      },
    ],
    [
      "missing folder prefix",
      {
        CLOUDINARY_CLOUD_NAME: "demo-cloud",
        CLOUDINARY_API_KEY: "demo-key",
        CLOUDINARY_API_SECRET: "demo-secret",
      },
    ],
  ])("rejects an incomplete group: %s", (_label, input) => {
    const error = expectEnvError(input);
    expect(error).toBeInstanceOf(EnvironmentValidationError);
    expect(pathsOf(error).some((p) => p.startsWith("CLOUDINARY_"))).toBe(true);
  });

  it("rejects an invalid folder value", () => {
    const error = expectEnvError(cloudinaryGroup("staging"));
    expect(pathsOf(error)).toContain("CLOUDINARY_FOLDER_PREFIX");
  });

  it("requires dev in a local environment", () => {
    const error = expectEnvError(cloudinaryGroup("preview"));
    expect(pathsOf(error)).toContain("CLOUDINARY_FOLDER_PREFIX");
  });

  it("requires preview in a preview environment", () => {
    const error = expectEnvError({
      ...previewUrls(),
      ...cloudinaryGroup("prod"),
    });
    expect(pathsOf(error)).toContain("CLOUDINARY_FOLDER_PREFIX");
  });

  it("requires prod in a production environment", () => {
    const error = expectEnvError({
      ...productionUrls(),
      ...cloudinaryGroup("preview"),
    });
    expect(pathsOf(error)).toContain("CLOUDINARY_FOLDER_PREFIX");
  });

  it("accepts a valid local configuration", () => {
    const env = parseEnv(cloudinaryGroup("dev"));
    expect(env.CLOUDINARY_FOLDER_PREFIX).toBe("dev");
  });

  it("accepts a valid preview configuration", () => {
    const env = parseEnv({ ...previewUrls(), ...cloudinaryGroup("preview") });
    expect(env.CLOUDINARY_FOLDER_PREFIX).toBe("preview");
  });

  it("accepts a valid production configuration", () => {
    const env = parseEnv({ ...productionUrls(), ...cloudinaryGroup("prod") });
    expect(env.CLOUDINARY_FOLDER_PREFIX).toBe("prod");
  });
});

// --- Resend group --------------------------------------------------------

describe("resend group", () => {
  it("accepts the entire group absent", () => {
    const env = parseEnv({});
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
  });

  it("rejects a partial group", () => {
    const error = expectEnvError({ RESEND_API_KEY: "re_demo" });
    expect(pathsOf(error)).toContain("EMAIL_FROM");
    expect(pathsOf(error)).toContain("INQUIRY_NOTIFICATION_FALLBACK");
  });

  it("rejects an invalid sender email", () => {
    const error = expectEnvError({
      RESEND_API_KEY: "re_demo",
      EMAIL_FROM: "not-an-email",
      INQUIRY_NOTIFICATION_FALLBACK: "fallback@example.com",
    });
    expect(pathsOf(error)).toContain("EMAIL_FROM");
  });

  it("rejects an invalid fallback email", () => {
    const error = expectEnvError({
      RESEND_API_KEY: "re_demo",
      EMAIL_FROM: "no-reply@example.com",
      INQUIRY_NOTIFICATION_FALLBACK: "not-an-email",
    });
    expect(pathsOf(error)).toContain("INQUIRY_NOTIFICATION_FALLBACK");
  });

  it("accepts a complete valid group", () => {
    const env = parseEnv({
      RESEND_API_KEY: "re_demo",
      EMAIL_FROM: "no-reply@example.com",
      INQUIRY_NOTIFICATION_FALLBACK: "fallback@example.com",
    });
    expect(env.EMAIL_FROM).toBe("no-reply@example.com");
    expect(env.INQUIRY_NOTIFICATION_FALLBACK).toBe("fallback@example.com");
  });
});

// --- Upstash group -------------------------------------------------------

describe("upstash group", () => {
  it("accepts the entire group absent", () => {
    const env = parseEnv({});
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.RATE_LIMIT_NAMESPACE).toBeUndefined();
  });

  it("rejects a partial group", () => {
    const error = expectEnvError({
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    });
    expect(pathsOf(error)).toContain("UPSTASH_REDIS_REST_TOKEN");
    expect(pathsOf(error)).toContain("RATE_LIMIT_NAMESPACE");
  });

  it("rejects an HTTP Redis REST URL", () => {
    const error = expectEnvError({
      UPSTASH_REDIS_REST_URL: "http://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: "demo-token",
      RATE_LIMIT_NAMESPACE: "dev:",
    });
    expect(pathsOf(error)).toContain("UPSTASH_REDIS_REST_URL");
  });

  it("rejects an invalid namespace", () => {
    const error = expectEnvError(upstashGroup("staging:"));
    expect(pathsOf(error)).toContain("RATE_LIMIT_NAMESPACE");
  });

  it("requires dev: in a local environment", () => {
    const error = expectEnvError(upstashGroup("preview:"));
    expect(pathsOf(error)).toContain("RATE_LIMIT_NAMESPACE");
  });

  it("requires preview: in a preview environment", () => {
    const error = expectEnvError({
      ...previewUrls(),
      ...upstashGroup("prod:"),
    });
    expect(pathsOf(error)).toContain("RATE_LIMIT_NAMESPACE");
  });

  it("requires prod: in a production environment", () => {
    const error = expectEnvError({
      ...productionUrls(),
      ...upstashGroup("preview:"),
    });
    expect(pathsOf(error)).toContain("RATE_LIMIT_NAMESPACE");
  });

  it("accepts a valid local group", () => {
    const env = parseEnv(upstashGroup("dev:"));
    expect(env.RATE_LIMIT_NAMESPACE).toBe("dev:");
  });

  it("accepts a valid preview group", () => {
    const env = parseEnv({ ...previewUrls(), ...upstashGroup("preview:") });
    expect(env.RATE_LIMIT_NAMESPACE).toBe("preview:");
  });

  it("accepts a valid production group", () => {
    const env = parseEnv({ ...productionUrls(), ...upstashGroup("prod:") });
    expect(env.RATE_LIMIT_NAMESPACE).toBe("prod:");
  });
});

// --- Sentry group --------------------------------------------------------

describe("sentry group", () => {
  it("accepts the runtime group entirely absent", () => {
    const env = parseEnv({});
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined();
  });

  it("rejects a partial runtime group", () => {
    const error = expectEnvError({
      SENTRY_DSN: "https://key@sentry.example.com/1",
    });
    expect(pathsOf(error)).toContain("NEXT_PUBLIC_SENTRY_DSN");
    expect(pathsOf(error)).toContain("SENTRY_ENVIRONMENT");
  });

  it("rejects a non-HTTPS DSN", () => {
    const error = expectEnvError({
      SENTRY_DSN: "http://key@sentry.example.com/1",
      NEXT_PUBLIC_SENTRY_DSN: "https://key@sentry.example.com/2",
      SENTRY_ENVIRONMENT: "development",
    });
    expect(pathsOf(error)).toContain("SENTRY_DSN");
  });

  it("requires development in a local environment", () => {
    const error = expectEnvError(sentryGroup("preview"));
    expect(pathsOf(error)).toContain("SENTRY_ENVIRONMENT");
  });

  it("requires preview in a preview environment", () => {
    const error = expectEnvError({
      ...previewUrls(),
      ...sentryGroup("production"),
    });
    expect(pathsOf(error)).toContain("SENTRY_ENVIRONMENT");
  });

  it("requires production in a production environment", () => {
    const error = expectEnvError({
      ...productionUrls(),
      ...sentryGroup("preview"),
    });
    expect(pathsOf(error)).toContain("SENTRY_ENVIRONMENT");
  });

  it("accepts SENTRY_AUTH_TOKEN supplied independently", () => {
    const env = parseEnv({ SENTRY_AUTH_TOKEN: "demo-ci-token" });
    expect(env.SENTRY_AUTH_TOKEN).toBe("demo-ci-token");
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("accepts a complete valid runtime group", () => {
    const env = parseEnv(sentryGroup("development"));
    expect(env.SENTRY_ENVIRONMENT).toBe("development");
    expect(env.SENTRY_DSN).toBe("https://key@sentry.example.com/1");
  });
});

// --- Seed credentials ----------------------------------------------------

describe("seed credentials", () => {
  it("accepts both absent", () => {
    const env = parseEnv({});
    expect(env.SEED_OWNER_EMAIL).toBeUndefined();
    expect(env.SEED_OWNER_PASSWORD).toBeUndefined();
  });

  it("rejects a partial group", () => {
    const error = expectEnvError({ SEED_OWNER_EMAIL: "owner@example.com" });
    expect(pathsOf(error)).toContain("SEED_OWNER_PASSWORD");
  });

  it("rejects an invalid email", () => {
    const error = expectEnvError({
      SEED_OWNER_EMAIL: "not-an-email",
      SEED_OWNER_PASSWORD: "long-enough-password",
    });
    expect(pathsOf(error)).toContain("SEED_OWNER_EMAIL");
  });

  it("rejects a password shorter than 12 characters", () => {
    const error = expectEnvError({
      SEED_OWNER_EMAIL: "owner@example.com",
      SEED_OWNER_PASSWORD: "short",
    });
    expect(pathsOf(error)).toContain("SEED_OWNER_PASSWORD");
  });

  it("accepts valid local seed credentials", () => {
    const env = parseEnv({
      SEED_OWNER_EMAIL: "owner@example.com",
      SEED_OWNER_PASSWORD: "long-enough-password",
    });
    expect(env.SEED_OWNER_EMAIL).toBe("owner@example.com");
  });

  it("accepts valid preview seed credentials", () => {
    const env = parseEnv({
      ...previewUrls(),
      SEED_OWNER_EMAIL: "owner@example.com",
      SEED_OWNER_PASSWORD: "long-enough-password",
    });
    expect(env.SEED_OWNER_EMAIL).toBe("owner@example.com");
  });

  it("rejects any seed credentials in production", () => {
    const error = expectEnvError({
      ...productionUrls(),
      SEED_OWNER_EMAIL: "owner@example.com",
      SEED_OWNER_PASSWORD: "long-enough-password",
    });
    expect(pathsOf(error)).toContain("SEED_OWNER_PASSWORD");
  });
});

// --- Error safety --------------------------------------------------------

describe("error safety", () => {
  it("does not leak a marker placed in AUTH_SECRET", () => {
    const marker = "LEAK_AUTH_MARKER";
    const error = expectEnvError({
      AUTH_SECRET: `${marker}-short`,
      AUTH_URL: "http://localhost:3000",
    });
    expect(pathsOf(error)).toContain("AUTH_SECRET");
    expectNoMarker(error, marker);
  });

  it("does not leak a marker inside a malformed database URL", () => {
    const marker = "LEAK_DB_MARKER";
    const error = expectEnvError({
      DATABASE_URL: `mysql://user:${marker}@db.example.com:3306/app`,
      DIRECT_DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
    });
    expect(pathsOf(error)).toContain("DATABASE_URL");
    expectNoMarker(error, marker);
  });

  it("does not leak a marker inside a provider token", () => {
    const marker = "LEAK_TOKEN_MARKER";
    const error = expectEnvError({
      UPSTASH_REDIS_REST_URL: "http://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: `${marker}-token`,
      RATE_LIMIT_NAMESPACE: "dev:",
    });
    expect(pathsOf(error)).toContain("UPSTASH_REDIS_REST_URL");
    expectNoMarker(error, marker);
  });

  it("uses the exact error name EnvironmentValidationError", () => {
    const error = expectEnvError({ NODE_ENV: "staging" });
    expect(error.name).toBe("EnvironmentValidationError");
  });

  it("reports safe variable paths and descriptions", () => {
    const error = expectEnvError({
      AUTH_SECRET: "too-short",
      AUTH_URL: "http://localhost:4000",
    });
    expect(error.issues.length).toBeGreaterThan(0);
    for (const issue of error.issues) {
      expect(typeof issue.path).toBe("string");
      expect(issue.path.length).toBeGreaterThan(0);
      expect(typeof issue.message).toBe("string");
      expect(issue.message.length).toBeGreaterThan(0);
    }
    expect(error.message).toContain("Invalid environment configuration");
  });

  it("deduplicates repeated path and message pairs", () => {
    const error = new EnvironmentValidationError([
      { path: "AUTH_SECRET", message: "Must contain at least 32 characters" },
      { path: "AUTH_SECRET", message: "Must contain at least 32 characters" },
    ]);
    expect(error.issues).toHaveLength(1);
    const occurrences = error.message.split("AUTH_SECRET").length - 1;
    expect(occurrences).toBe(1);
  });
});

// --- A fully valid multi-group configuration -----------------------------

describe("fully valid configuration", () => {
  it("accepts a complete preview configuration", () => {
    const env = parseEnv(validPreview());
    expect(env.VERCEL_ENV).toBe("preview");
    expect(env.CLOUDINARY_FOLDER_PREFIX).toBe("preview");
    expect(env.RATE_LIMIT_NAMESPACE).toBe("preview:");
    expect(env.SENTRY_ENVIRONMENT).toBe("preview");
    expect(env.DATABASE_URL).toBe("postgres://user:pw@db.example.com:5432/app");
    expect(Object.isFrozen(env)).toBe(true);
  });
});
