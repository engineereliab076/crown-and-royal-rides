import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  type AuthPrismaClient,
  createPrismaAuthRepository,
} from "@/server/modules/auth/repository";

interface FindUniqueArgs {
  where: Record<string, unknown>;
  select: Record<string, true>;
}

function clientWith(
  findUnique: (args: FindUniqueArgs) => unknown,
): AuthPrismaClient {
  return {
    adminUser: { findUnique },
  } as unknown as AuthPrismaClient;
}

const CREDENTIAL_ROW = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  email: "owner@example.com",
  name: "Test Owner",
  passwordHash: "$argon2id$v=19$m=65536,p=4,t=3$abc$def",
  role: AdminRole.owner,
  isActive: true,
  sessionVersion: 1,
  mustChangePassword: true,
};

describe("createPrismaAuthRepository.findCredentialByEmail", () => {
  it("selects credential fields (including passwordHash) by email", async () => {
    const findUnique = vi
      .fn<(args: FindUniqueArgs) => unknown>()
      .mockReturnValue(CREDENTIAL_ROW);
    const repository = createPrismaAuthRepository(clientWith(findUnique));

    const result = await repository.findCredentialByEmail("owner@example.com");

    expect(result).toEqual(CREDENTIAL_ROW);
    const args = findUnique.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ email: "owner@example.com" });
    expect(Object.keys(args?.select ?? {}).sort()).toEqual(
      [
        "email",
        "id",
        "isActive",
        "mustChangePassword",
        "name",
        "passwordHash",
        "role",
        "sessionVersion",
      ].sort(),
    );
  });

  it("returns null when no administrator matches", async () => {
    const repository = createPrismaAuthRepository(clientWith(() => null));
    await expect(
      repository.findCredentialByEmail("missing@example.com"),
    ).resolves.toBeNull();
  });
});

describe("createPrismaAuthRepository.findSessionById", () => {
  it("selects session fields by id and never selects passwordHash", async () => {
    const findUnique = vi
      .fn<(args: FindUniqueArgs) => unknown>()
      .mockReturnValue({
        id: CREDENTIAL_ROW.id,
        name: CREDENTIAL_ROW.name,
        role: CREDENTIAL_ROW.role,
        isActive: CREDENTIAL_ROW.isActive,
        sessionVersion: CREDENTIAL_ROW.sessionVersion,
        mustChangePassword: CREDENTIAL_ROW.mustChangePassword,
      });
    const repository = createPrismaAuthRepository(clientWith(findUnique));

    const result = await repository.findSessionById(CREDENTIAL_ROW.id);

    expect(result).not.toHaveProperty("passwordHash");
    const args = findUnique.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: CREDENTIAL_ROW.id });
    expect(args?.select).not.toHaveProperty("passwordHash");
    expect(args?.select).not.toHaveProperty("email");
    expect(Object.keys(args?.select ?? {}).sort()).toEqual(
      [
        "id",
        "isActive",
        "mustChangePassword",
        "name",
        "role",
        "sessionVersion",
      ].sort(),
    );
  });

  it("returns null when no administrator matches", async () => {
    const repository = createPrismaAuthRepository(clientWith(() => null));
    await expect(
      repository.findSessionById(CREDENTIAL_ROW.id),
    ).resolves.toBeNull();
  });
});

describe("createPrismaAuthRepository.findCredentialById", () => {
  it("selects credential fields (including passwordHash) by id", async () => {
    const findUnique = vi
      .fn<(args: FindUniqueArgs) => unknown>()
      .mockReturnValue(CREDENTIAL_ROW);
    const repository = createPrismaAuthRepository(clientWith(findUnique));

    await repository.findCredentialById(CREDENTIAL_ROW.id);

    const args = findUnique.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: CREDENTIAL_ROW.id });
    expect(args?.select).toHaveProperty("passwordHash");
  });
});

interface UpdateArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  select: Record<string, true>;
}

function clientWithUpdate(
  update: (args: UpdateArgs) => unknown,
): AuthPrismaClient {
  return {
    adminUser: { update },
  } as unknown as AuthPrismaClient;
}

describe("createPrismaAuthRepository.changePassword", () => {
  it("atomically sets the hash, clears forced-change, and increments version", async () => {
    const update = vi
      .fn<(args: UpdateArgs) => unknown>()
      .mockReturnValue({ sessionVersion: 5 });
    const repository = createPrismaAuthRepository(clientWithUpdate(update));

    const result = await repository.changePassword(
      CREDENTIAL_ROW.id,
      "$argon2id$new",
    );

    expect(result).toEqual({ sessionVersion: 5 });
    const args = update.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: CREDENTIAL_ROW.id });
    expect(args?.data.passwordHash).toBe("$argon2id$new");
    expect(args?.data.mustChangePassword).toBe(false);
    expect(args?.data.sessionVersion).toEqual({ increment: 1 });
    // Only the new session version is read back — never the password hash.
    expect(args?.select).toEqual({ sessionVersion: true });
  });
});

describe("createPrismaAuthRepository.recordLogin", () => {
  it("updates lastLoginAt without selecting sensitive fields", async () => {
    const update = vi
      .fn<(args: UpdateArgs) => unknown>()
      .mockReturnValue({ id: CREDENTIAL_ROW.id });
    const repository = createPrismaAuthRepository(clientWithUpdate(update));

    await repository.recordLogin(CREDENTIAL_ROW.id);

    const args = update.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: CREDENTIAL_ROW.id });
    expect(args?.data.lastLoginAt).toBeInstanceOf(Date);
    expect(args?.select).toEqual({ id: true });
    expect(args?.select).not.toHaveProperty("passwordHash");
  });
});
