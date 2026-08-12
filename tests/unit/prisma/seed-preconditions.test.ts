import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseSeedEnvironment,
  safeSeedErrorMessage,
  SeedPreconditionError,
} from "../../../prisma/seed-preconditions";

const PASSWORD = "SEED_PASSWORD_LEAK_MARKER_never_used";
const LOCAL_URL =
  "postgresql://local_app:fake@127.0.0.1:5432/crown_royal_rides_test";
const PRODUCTION_URL =
  "postgresql://crr_application:fake@ep-example-pooler.eu-central-1.aws.neon.tech/app?sslmode=require";
const ACKNOWLEDGEMENT = "CREATE_EXACTLY_ONE_PRODUCTION_OWNER";

function base(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: LOCAL_URL,
    SEED_OWNER_EMAIL: "owner@example.test",
    SEED_OWNER_PASSWORD: PASSWORD,
    ...overrides,
  };
}

function production(overrides: Record<string, string | undefined> = {}) {
  return base({
    DATABASE_URL: PRODUCTION_URL,
    SEED_TARGET: "production",
    ALLOW_PRODUCTION_FIRST_OWNER_SEED: ACKNOWLEDGEMENT,
    ...overrides,
  });
}

function captureError(input: Record<string, string | undefined>) {
  try {
    parseSeedEnvironment(input);
  } catch (error) {
    if (error instanceof SeedPreconditionError) return error;
    throw error;
  }
  throw new Error("Expected seed environment parsing to fail");
}

describe("dedicated seed environment parser", () => {
  it("accepts safe local and test targets without a Production acknowledgement", () => {
    expect(parseSeedEnvironment(base())).toMatchObject({ target: "local" });
    expect(parseSeedEnvironment(base({ SEED_TARGET: "test" }))).toMatchObject({
      target: "test",
    });
  });

  it("requires both exact Production acknowledgement values", () => {
    expect(
      captureError(production({ ALLOW_PRODUCTION_FIRST_OWNER_SEED: undefined }))
        .code,
    ).toBe("PRODUCTION_ACKNOWLEDGEMENT_REQUIRED");
    expect(
      captureError(
        production({
          ALLOW_PRODUCTION_FIRST_OWNER_SEED:
            "CREATE_EXACTLY_ONE_PRODUCTION_OWNER ",
        }),
      ).code,
    ).toBe("PRODUCTION_ACKNOWLEDGEMENT_REQUIRED");
    expect(
      captureError(
        base({
          DATABASE_URL: PRODUCTION_URL,
          SEED_TARGET: "Production",
          ALLOW_PRODUCTION_FIRST_OWNER_SEED: ACKNOWLEDGEMENT,
        }),
      ).code,
    ).toBe("SEED_TARGET_INVALID");
    expect(parseSeedEnvironment(production())).toMatchObject({
      target: "production",
      databaseUrl: PRODUCTION_URL,
    });
  });

  it("rejects an owner or migration-role URL in Production", () => {
    const error = captureError(
      production({
        DATABASE_URL:
          "postgresql://neondb_owner:fake@ep-example-pooler.eu-central-1.aws.neon.tech/app?sslmode=require",
      }),
    );
    expect(error.code).toBe("PRODUCTION_APPLICATION_ROLE_REQUIRED");
    expect(error.message).not.toContain("neondb_owner:fake");
  });

  it("rejects a non-pooler Production URL", () => {
    expect(
      captureError(
        production({
          DATABASE_URL:
            "postgresql://crr_application:fake@ep-example.eu-central-1.aws.neon.tech/app?sslmode=require",
        }),
      ).code,
    ).toBe("PRODUCTION_POOLED_NEON_URL_REQUIRED");
  });

  it("requires SSL for Production", () => {
    expect(
      captureError(
        production({
          DATABASE_URL:
            "postgresql://crr_application:fake@ep-example-pooler.eu-central-1.aws.neon.tech/app",
        }),
      ).code,
    ).toBe("PRODUCTION_SSL_REQUIRED");
  });

  it("rejects a managed Neon URL in local or test mode", () => {
    expect(
      captureError(
        base({ DATABASE_URL: PRODUCTION_URL, SEED_TARGET: undefined }),
      ).code,
    ).toBe("MANAGED_NEON_TARGET_FORBIDDEN");
    expect(
      captureError(base({ DATABASE_URL: PRODUCTION_URL, SEED_TARGET: "test" }))
        .code,
    ).toBe("MANAGED_NEON_TARGET_FORBIDDEN");
  });

  it("validates only the seed's five variables", () => {
    expect(
      parseSeedEnvironment({
        ...base(),
        VERCEL_ENV: "production",
        DIRECT_DATABASE_URL: "not-a-url",
        AUTH_SECRET: "short",
        CLOUDINARY_API_SECRET: "unrelated",
      }),
    ).toEqual({
      databaseUrl: LOCAL_URL,
      ownerEmail: "owner@example.test",
      ownerPassword: PASSWORD,
      target: "local",
    });
  });

  it("requires valid database and seed credential inputs", () => {
    expect(captureError(base({ DATABASE_URL: undefined })).code).toBe(
      "DATABASE_URL_REQUIRED",
    );
    expect(
      captureError(base({ DATABASE_URL: "https://example.test" })).code,
    ).toBe("DATABASE_URL_INVALID");
    expect(captureError(base({ SEED_OWNER_PASSWORD: undefined })).code).toBe(
      "SEED_CREDENTIALS_REQUIRED",
    );
    expect(captureError(base({ SEED_OWNER_PASSWORD: "too-short" })).code).toBe(
      "SEED_PASSWORD_INVALID",
    );
  });

  it("never exposes unknown errors, passwords, or connection credentials", () => {
    const marker = "SECRET_CONNECTION_OR_PASSWORD_MARKER";
    expect(safeSeedErrorMessage(new Error(marker))).toBe(
      "The seed failed safely without writing data.",
    );
    expect(safeSeedErrorMessage(new Error(marker))).not.toContain(marker);

    const error = captureError(
      production({ DATABASE_URL: "postgresql://wrong:secret@example.test/db" }),
    );
    const message = safeSeedErrorMessage(error);
    expect(message).not.toContain("secret");
    expect(message).not.toContain("postgresql://");
  });

  it("parses before constructing Prisma and does not import the application parser", () => {
    const source = readFileSync(
      new URL("../../../prisma/seed.ts", import.meta.url),
      "utf8",
    );
    const main = source.slice(source.indexOf("async function main"));

    expect(source).not.toContain("src/lib/env");
    expect(main.indexOf("parseSeedEnvironment(process.env)")).toBeGreaterThan(
      -1,
    );
    expect(main.indexOf("new PrismaPg(")).toBeGreaterThan(
      main.indexOf("parseSeedEnvironment(process.env)"),
    );
    expect(main).not.toMatch(
      /\.(?:\$queryRaw|\$executeRaw|create|update|delete)\s*\(/u,
    );
  });
});
