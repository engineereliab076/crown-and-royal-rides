import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { AppError, isAppError } from "@/server/http/errors";
import { hashPassword, verifyPassword } from "@/server/modules/auth/password";
import type {
  AuthRepository,
  CredentialAdmin,
} from "@/server/modules/auth/repository";
import {
  createAuthService,
  CredentialVerificationError,
} from "@/server/modules/auth/service";

import { FakeAuthRepository } from "./support/fake-auth-repository";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PASSWORD = "owner-password-123";

async function ownerRecord(
  overrides: Partial<CredentialAdmin> = {},
): Promise<CredentialAdmin> {
  return {
    id: OWNER_ID,
    email: "owner@example.com",
    name: "Test Owner",
    passwordHash: await hashPassword(PASSWORD),
    role: AdminRole.owner,
    isActive: true,
    sessionVersion: 1,
    mustChangePassword: true,
    ...overrides,
  };
}

function expectInvalidCredentials(error: unknown): void {
  expect(isAppError(error)).toBe(true);
  const appError = error as AppError;
  expect(appError.status).toBe(401);
  expect(appError.code).toBe("AUTH_INVALID_CREDENTIALS");
  expect(appError.message).toBe("Invalid email or password.");
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected verifyCredentials to reject");
}

describe("createAuthService.verifyCredentials", () => {
  it("returns a safe authenticated administrator on success", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const result = await service.verifyCredentials({
      email: "owner@example.com",
      password: PASSWORD,
    });

    expect(result).toEqual({
      id: OWNER_ID,
      email: "owner@example.com",
      name: "Test Owner",
      role: AdminRole.owner,
      mustChangePassword: true,
      sessionVersion: 1,
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("normalizes the email before lookup", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const result = await service.verifyCredentials({
      email: "  Owner@Example.COM  ",
      password: PASSWORD,
    });

    expect(result.id).toBe(OWNER_ID);
  });

  it("rejects a wrong password", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    expectInvalidCredentials(
      await capture(
        service.verifyCredentials({
          email: "owner@example.com",
          password: "wrong-password",
        }),
      ),
    );
  });

  it("rejects an unknown email", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    expectInvalidCredentials(
      await capture(
        service.verifyCredentials({
          email: "nobody@example.com",
          password: PASSWORD,
        }),
      ),
    );
  });

  it("rejects an inactive administrator even with the correct password", async () => {
    const repository = new FakeAuthRepository([
      await ownerRecord({ isActive: false }),
    ]);
    const service = createAuthService({ repository });

    expectInvalidCredentials(
      await capture(
        service.verifyCredentials({
          email: "owner@example.com",
          password: PASSWORD,
        }),
      ),
    );
  });

  it("rejects a malformed stored hash with the same failure", async () => {
    const repository = new FakeAuthRepository([
      await ownerRecord({ passwordHash: "not-a-valid-argon2-hash" }),
    ]);
    const service = createAuthService({ repository });

    expectInvalidCredentials(
      await capture(
        service.verifyCredentials({
          email: "owner@example.com",
          password: PASSWORD,
        }),
      ),
    );
  });

  it("produces one identical, non-leaking failure across all failure modes", async () => {
    const active = await ownerRecord();
    const services = {
      wrongPassword: createAuthService({
        repository: new FakeAuthRepository([active]),
      }),
      unknownEmail: createAuthService({
        repository: new FakeAuthRepository([active]),
      }),
      inactive: createAuthService({
        repository: new FakeAuthRepository([
          await ownerRecord({ isActive: false }),
        ]),
      }),
      malformed: createAuthService({
        repository: new FakeAuthRepository([
          await ownerRecord({ passwordHash: "broken" }),
        ]),
      }),
    };

    const errors = [
      await capture(
        services.wrongPassword.verifyCredentials({
          email: "owner@example.com",
          password: "nope",
        }),
      ),
      await capture(
        services.unknownEmail.verifyCredentials({
          email: "ghost@example.com",
          password: PASSWORD,
        }),
      ),
      await capture(
        services.inactive.verifyCredentials({
          email: "owner@example.com",
          password: PASSWORD,
        }),
      ),
      await capture(
        services.malformed.verifyCredentials({
          email: "owner@example.com",
          password: PASSWORD,
        }),
      ),
    ];

    for (const error of errors) {
      expectInvalidCredentials(error);
      const appError = error as AppError;
      // The failure must not disclose the email or the supplied password.
      expect(appError.message).not.toContain("owner@example.com");
      expect(appError.message).not.toContain(PASSWORD);
    }
    // Every failure is byte-identical in the fields callers can observe.
    const shapes = errors.map((error) => {
      const appError = error as AppError;
      return `${appError.status}:${appError.code}:${appError.message}`;
    });
    expect(new Set(shapes).size).toBe(1);
  });

  it("injects dependencies, verifies once, and defends unknown emails by timing", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const verifyPassword = vi
      .fn<(passwordHash: string, password: string) => Promise<boolean>>()
      .mockResolvedValue(false);
    const service = createAuthService({ repository, verifyPassword });

    await capture(
      service.verifyCredentials({
        email: "nobody@example.com",
        password: "whatever",
      }),
    );

    // Exactly one credential lookup (no duplicate queries) ...
    expect(repository.credentialLookups).toBe(1);
    // ... and the verifier still runs on the unknown-email path (decoy hash),
    // so the response is not measurably faster than a real check.
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    const [hashArg] = verifyPassword.mock.calls[0] ?? [];
    expect(hashArg?.startsWith("$argon2id$")).toBe(true);
  });
});

describe("createAuthService.verifyCredentials — unexpected substage failures", () => {
  function repositoryThatThrows(cause: unknown): AuthRepository {
    return {
      findCredentialByEmail: async () => {
        throw cause;
      },
      findCredentialById: async () => null,
      findSessionById: async () => null,
      changePassword: async () => ({ sessionVersion: 1 }),
      recordLogin: async () => {},
    };
  }

  function repositoryReturning(admin: CredentialAdmin): AuthRepository {
    return {
      findCredentialByEmail: async () => admin,
      findCredentialById: async () => null,
      findSessionById: async () => null,
      changePassword: async () => ({ sessionVersion: 1 }),
      recordLogin: async () => {},
    };
  }

  it("classifies a database query failure as the repository phase", async () => {
    const dbError = new Error("connection terminated unexpectedly");
    const service = createAuthService({
      repository: repositoryThatThrows(dbError),
    });

    const error = await capture(
      service.verifyCredentials({
        email: "owner@example.com",
        password: PASSWORD,
      }),
    );

    expect(error).toBeInstanceOf(CredentialVerificationError);
    expect((error as CredentialVerificationError).phase).toBe("repository");
    // The raw database error is preserved as a cause but never in the message.
    expect((error as CredentialVerificationError).message).not.toContain(
      "connection terminated",
    );
    expect(isAppError(error)).toBe(false);
  });

  it("classifies a verifier fault as the password phase", async () => {
    const service = createAuthService({
      repository: new FakeAuthRepository([await ownerRecord()]),
      verifyPassword: async () => {
        throw new Error("argon2 native binding unavailable");
      },
    });

    const error = await capture(
      service.verifyCredentials({
        email: "owner@example.com",
        password: PASSWORD,
      }),
    );

    expect(error).toBeInstanceOf(CredentialVerificationError);
    expect((error as CredentialVerificationError).phase).toBe("password");
  });

  it("classifies a structurally invalid matched record as the record phase", async () => {
    const corrupt = {
      ...(await ownerRecord()),
      sessionVersion: Number.NaN,
    } as unknown as CredentialAdmin;
    const service = createAuthService({
      repository: repositoryReturning(corrupt),
      // A matching password, so the failure is the record shape, not the secret.
      verifyPassword: async () => true,
    });

    const error = await capture(
      service.verifyCredentials({
        email: "owner@example.com",
        password: PASSWORD,
      }),
    );

    expect(error).toBeInstanceOf(CredentialVerificationError);
    expect((error as CredentialVerificationError).phase).toBe("record");
  });

  it("keeps a malformed stored hash a generic rejection, not a substage failure", async () => {
    // Regression: the verifier resolves false for a malformed hash (never
    // throws), so this must stay AUTH_INVALID_CREDENTIALS — not password phase.
    const service = createAuthService({
      repository: new FakeAuthRepository([
        await ownerRecord({ passwordHash: "not-a-valid-argon2-hash" }),
      ]),
    });

    const error = await capture(
      service.verifyCredentials({
        email: "owner@example.com",
        password: PASSWORD,
      }),
    );

    expect(error).not.toBeInstanceOf(CredentialVerificationError);
    expectInvalidCredentials(error);
  });
});

describe("createAuthService.validateSession", () => {
  it("returns a safe session for a matching, active administrator", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const result = await service.validateSession({
      id: OWNER_ID,
      sessionVersion: 1,
    });

    expect(result).toEqual({
      id: OWNER_ID,
      name: "Test Owner",
      role: AdminRole.owner,
      mustChangePassword: true,
      sessionVersion: 1,
    });
    expect(result).not.toHaveProperty("passwordHash");
    // Exactly one indexed lookup per validation.
    expect(repository.sessionLookups).toBe(1);
  });

  it("rejects a missing administrator", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    await expect(
      service.validateSession({ id: "unknown-id", sessionVersion: 1 }),
    ).resolves.toBeNull();
  });

  it("rejects an inactive administrator", async () => {
    const repository = new FakeAuthRepository([
      await ownerRecord({ isActive: false }),
    ]);
    const service = createAuthService({ repository });

    await expect(
      service.validateSession({ id: OWNER_ID, sessionVersion: 1 }),
    ).resolves.toBeNull();
  });

  it("rejects a session-version mismatch", async () => {
    const repository = new FakeAuthRepository([
      await ownerRecord({ sessionVersion: 2 }),
    ]);
    const service = createAuthService({ repository });

    await expect(
      service.validateSession({ id: OWNER_ID, sessionVersion: 1 }),
    ).resolves.toBeNull();
  });

  it("rejects malformed input without a lookup", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    await expect(
      service.validateSession({ id: null, sessionVersion: 1 }),
    ).resolves.toBeNull();
    await expect(
      service.validateSession({ id: OWNER_ID, sessionVersion: null }),
    ).resolves.toBeNull();
    expect(repository.sessionLookups).toBe(0);
  });
});

describe("createAuthService.changePassword", () => {
  const NEW_PASSWORD = "brand-new-password-9";

  it("rotates the password: new hash, forced-change cleared, version bumped", async () => {
    const record = await ownerRecord({ sessionVersion: 3 });
    const repository = new FakeAuthRepository([record]);
    const service = createAuthService({ repository });

    await service.changePassword({
      actorId: OWNER_ID,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const stored = repository.peek(OWNER_ID);
    expect(stored?.passwordHash).not.toBe(record.passwordHash);
    expect(stored?.passwordHash.startsWith("$argon2id$")).toBe(true);
    // Plaintext is never persisted.
    expect(stored?.passwordHash).not.toContain(NEW_PASSWORD);
    expect(stored?.mustChangePassword).toBe(false);
    expect(stored?.sessionVersion).toBe(4);
    // The new password verifies against the freshly stored hash.
    expect(await verifyPassword(stored?.passwordHash ?? "", NEW_PASSWORD)).toBe(
      true,
    );
  });

  it("invalidates the prior session (old version fails validation afterwards)", async () => {
    const repository = new FakeAuthRepository([
      await ownerRecord({ sessionVersion: 1 }),
    ]);
    const service = createAuthService({ repository });

    await service.changePassword({
      actorId: OWNER_ID,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    // The session that made the change (version 1) no longer validates.
    await expect(
      service.validateSession({ id: OWNER_ID, sessionVersion: 1 }),
    ).resolves.toBeNull();
    // The new version does validate.
    await expect(
      service.validateSession({ id: OWNER_ID, sessionVersion: 2 }),
    ).resolves.not.toBeNull();
  });

  it("fails safely on an incorrect current password without writing", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const error = await capture(
      service.changePassword({
        actorId: OWNER_ID,
        currentPassword: "wrong-current-password",
        newPassword: NEW_PASSWORD,
      }),
    );
    expect(isAppError(error)).toBe(true);
    expect((error as AppError).code).toBe("CURRENT_PASSWORD_INVALID");
    expect(repository.passwordChanges).toBe(0);
  });

  it("rejects a weak new password", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const error = await capture(
      service.changePassword({
        actorId: OWNER_ID,
        currentPassword: PASSWORD,
        newPassword: "short",
      }),
    );
    expect((error as AppError).code).toBe("WEAK_PASSWORD");
    expect(repository.passwordChanges).toBe(0);
  });

  it("rejects reusing the current password", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const error = await capture(
      service.changePassword({
        actorId: OWNER_ID,
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }),
    );
    expect((error as AppError).code).toBe("PASSWORD_REUSED");
    expect(repository.passwordChanges).toBe(0);
  });

  it("never includes the plaintext in a thrown error", async () => {
    const repository = new FakeAuthRepository([await ownerRecord()]);
    const service = createAuthService({ repository });

    const error = await capture(
      service.changePassword({
        actorId: OWNER_ID,
        currentPassword: "wrong-current-password",
        newPassword: NEW_PASSWORD,
      }),
    );
    expect(String(error)).not.toContain(NEW_PASSWORD);
    expect(String(error)).not.toContain(PASSWORD);
  });
});
