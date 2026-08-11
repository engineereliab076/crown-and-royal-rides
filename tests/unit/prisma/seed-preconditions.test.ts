import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env.schema";

import {
  assertPhase2PasswordHashingAvailable,
  assertSeedStartupPreconditions,
  safeSeedErrorMessage,
  SeedPreconditionError,
} from "../../../prisma/seed-preconditions";

const fakeEnvironment = {
  DATABASE_URL: "postgresql://fake:fake@127.0.0.1:1/crown_royal_rides_test",
  DIRECT_DATABASE_URL:
    "postgresql://fake:fake@127.0.0.1:1/crown_royal_rides_test",
  SEED_OWNER_EMAIL: "owner@example.test",
  SEED_OWNER_PASSWORD: "SEED_PASSWORD_LEAK_MARKER_never_used",
};

function captureSeedPreconditionError(
  environment: Parameters<typeof assertSeedStartupPreconditions>[0],
): SeedPreconditionError {
  try {
    assertSeedStartupPreconditions(environment);
  } catch (error) {
    if (error instanceof SeedPreconditionError) return error;
    throw error;
  }
  throw new Error("Expected a seed precondition failure");
}

describe("seed preconditions", () => {
  it("rejects Production before considering credentials", () => {
    expect(() =>
      assertSeedStartupPreconditions({ VERCEL_ENV: "production" }),
    ).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_SEED_FORBIDDEN" }),
    );
  });

  it("requires the complete seed credential pair", () => {
    expect(() =>
      assertSeedStartupPreconditions({
        DIRECT_DATABASE_URL: fakeEnvironment.DIRECT_DATABASE_URL,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SEED_CREDENTIALS_REQUIRED" }),
    );
    expect(() =>
      assertSeedStartupPreconditions({
        ...fakeEnvironment,
        SEED_OWNER_PASSWORD: undefined,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SEED_CREDENTIALS_REQUIRED" }),
    );
  });

  it("requires the direct database URL", () => {
    expect(() =>
      assertSeedStartupPreconditions({
        SEED_OWNER_EMAIL: fakeEnvironment.SEED_OWNER_EMAIL,
        SEED_OWNER_PASSWORD: fakeEnvironment.SEED_OWNER_PASSWORD,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "DIRECT_DATABASE_URL_REQUIRED" }),
    );
  });

  it("returns credentials without logging or transforming them", () => {
    expect(assertSeedStartupPreconditions(fakeEnvironment)).toEqual({
      directDatabaseUrl: fakeEnvironment.DIRECT_DATABASE_URL,
      ownerEmail: fakeEnvironment.SEED_OWNER_EMAIL,
      ownerPassword: fakeEnvironment.SEED_OWNER_PASSWORD,
    });
  });

  it("always refuses owner creation until Phase 2 hashing exists", () => {
    expect(assertPhase2PasswordHashingAvailable).toThrowError(
      expect.objectContaining({ code: "PASSWORD_HASHING_UNAVAILABLE" }),
    );
  });

  it("never exposes an unknown failure or credential marker", () => {
    const marker = "SEED_PASSWORD_LEAK_MARKER";
    expect(safeSeedErrorMessage(new Error(marker))).toBe(
      "The seed skeleton failed safely without writing data.",
    );
    expect(safeSeedErrorMessage(new Error(marker))).not.toContain(marker);
  });

  it("uses a stable provider-neutral error name", () => {
    const error = new SeedPreconditionError(
      "PASSWORD_HASHING_UNAVAILABLE",
      "Safe message",
    );
    expect(error.name).toBe("SeedPreconditionError");
  });

  it("parses a plain environment snapshot before validating seed inputs", () => {
    const environment = parseEnv({ ...fakeEnvironment });

    expect(assertSeedStartupPreconditions(environment)).toEqual({
      directDatabaseUrl: fakeEnvironment.DIRECT_DATABASE_URL,
      ownerEmail: fakeEnvironment.SEED_OWNER_EMAIL,
      ownerPassword: fakeEnvironment.SEED_OWNER_PASSWORD,
    });
  });

  it("reports missing credentials without mentioning the hashing guard", () => {
    const error = captureSeedPreconditionError(parseEnv({}));
    const message = safeSeedErrorMessage(error);

    expect(error.code).toBe("SEED_CREDENTIALS_REQUIRED");
    expect(message).toBe(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required for seeding.",
    );
    expect(message).not.toContain("Argon2id");
    expect(message).not.toContain("PASSWORD_HASHING_UNAVAILABLE");
  });

  it("reaches the hashing guard with complete fake local configuration safely", () => {
    const environment = parseEnv({ ...fakeEnvironment });
    const configuration = assertSeedStartupPreconditions(environment);
    let error: unknown;

    try {
      assertPhase2PasswordHashingAvailable();
    } catch (caught) {
      error = caught;
    }

    expect(configuration.ownerEmail).toBe(fakeEnvironment.SEED_OWNER_EMAIL);
    expect(error).toEqual(
      expect.objectContaining({ code: "PASSWORD_HASHING_UNAVAILABLE" }),
    );
    expect(safeSeedErrorMessage(error)).toContain(
      "disabled until the Phase 2 Argon2id password-hashing service is available",
    );
    expect(safeSeedErrorMessage(error)).not.toContain(
      fakeEnvironment.SEED_OWNER_PASSWORD,
    );
  });

  it("rejects a production-shaped snapshot before credentials or hashing", () => {
    const environment = parseEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://production.example.test",
      APP_ORIGIN: "https://production.example.test",
    });
    const error = captureSeedPreconditionError(environment);
    const message = safeSeedErrorMessage(error);

    expect(error.code).toBe("PRODUCTION_SEED_FORBIDDEN");
    expect(message).toBe("The seed skeleton must never run in Production.");
    expect(message).not.toContain("SEED_OWNER");
    expect(message).not.toContain("Argon2id");
  });

  it("keeps snapshot parsing and all guards ahead of Prisma construction", () => {
    const source = readFileSync(
      new URL("../../../prisma/seed.ts", import.meta.url),
      "utf8",
    );
    const main = source.slice(source.indexOf("async function main"));
    const parseIndex = main.indexOf("parseEnv({ ...process.env })");
    const preconditionsIndex = main.indexOf("assertSeedStartupPreconditions(");
    const hashingIndex = main.indexOf("assertPhase2PasswordHashingAvailable()");
    const adapterIndex = main.indexOf("new PrismaPg(");
    const clientIndex = main.indexOf("new PrismaClient(");

    expect(parseIndex).toBeGreaterThan(-1);
    expect(preconditionsIndex).toBeGreaterThan(parseIndex);
    expect(hashingIndex).toBeGreaterThan(preconditionsIndex);
    expect(adapterIndex).toBeGreaterThan(hashingIndex);
    expect(clientIndex).toBeGreaterThan(adapterIndex);
    expect(main).not.toMatch(
      /\.(?:\$queryRaw|\$executeRaw|create|update|delete)\s*\(/u,
    );
  });
});
