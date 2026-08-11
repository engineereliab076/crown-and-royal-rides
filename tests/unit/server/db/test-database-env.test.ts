import { describe, expect, it } from "vitest";

import {
  loadTestDatabaseConfig,
  TestDatabaseSafetyError,
  type EnvSource,
} from "../../../integration/support/test-database-env";

const SAFE_URL = "postgresql://tester:pw@localhost:5433/crown_scratch_test";
const SAFE_DIRECT = "postgresql://tester:pw@localhost:5433/crown_scratch_test";

function baseEnv(overrides: EnvSource = {}): EnvSource {
  return {
    TEST_DATABASE_URL: SAFE_URL,
    TEST_DIRECT_DATABASE_URL: SAFE_DIRECT,
    ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS: "true",
    ...overrides,
  };
}

describe("loadTestDatabaseConfig", () => {
  it("accepts a well-named, acknowledged test database", () => {
    const config = loadTestDatabaseConfig(baseEnv());

    expect(config.databaseName).toBe("crown_scratch_test");
    expect(config.databaseUrl).toBe(SAFE_URL);
    expect(config.directUrl).toBe(SAFE_DIRECT);
  });

  it("requires the acknowledgement variable to be exactly true", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({ ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS: "yes" }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a missing test URL", () => {
    expect(() =>
      loadTestDatabaseConfig(baseEnv({ TEST_DATABASE_URL: undefined })),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a database name without a test marker", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL:
            "postgresql://tester:pw@localhost:5433/crown_royal_rides",
          TEST_DIRECT_DATABASE_URL:
            "postgresql://tester:pw@localhost:5433/crown_royal_rides",
        }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a production-like database name even with a test marker", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL:
            "postgresql://tester:pw@localhost:5433/preview_test",
          TEST_DIRECT_DATABASE_URL:
            "postgresql://tester:pw@localhost:5433/preview_test",
        }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a managed provider host", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL:
            "postgresql://tester:pw@ep-cool-name.eu-central-1.aws.neon.tech/scratch_test",
          TEST_DIRECT_DATABASE_URL:
            "postgresql://tester:pw@ep-cool-name.eu-central-1.aws.neon.tech/scratch_test",
        }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects an empty database name", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL: "postgresql://tester:pw@localhost:5433/",
          TEST_DIRECT_DATABASE_URL: "postgresql://tester:pw@localhost:5433/",
        }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a non-postgres protocol", () => {
    expect(() =>
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL: "mysql://tester:pw@localhost/scratch_test",
        }),
      ),
    ).toThrow(TestDatabaseSafetyError);
  });

  it("never includes the supplied URL or credentials in the error", () => {
    const secretUrl =
      "postgresql://secretuser:supersecretpassword@db.internal.example/crown_royal_rides";
    try {
      loadTestDatabaseConfig(
        baseEnv({
          TEST_DATABASE_URL: secretUrl,
          TEST_DIRECT_DATABASE_URL: secretUrl,
        }),
      );
      throw new Error("Expected loadTestDatabaseConfig to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(TestDatabaseSafetyError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("supersecretpassword");
      expect(message).not.toContain("secretuser");
      expect(message).not.toContain("db.internal.example");
    }
  });
});
