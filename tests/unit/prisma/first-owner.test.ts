import { describe, expect, it, vi } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  createFirstOwner,
  seedOutcomeMessage,
} from "../../../prisma/first-owner";
import {
  safeSeedErrorMessage,
  SeedConflictError,
  type SeedStartupConfiguration,
} from "../../../prisma/seed-preconditions";

const PLAINTEXT = "SEED_OWNER_PLAINTEXT_LEAK_MARKER_12";

function configuration(
  overrides: Partial<SeedStartupConfiguration> = {},
): SeedStartupConfiguration {
  return {
    databaseUrl: "postgresql://local_app:fake@127.0.0.1:1/local_test",
    ownerEmail: "owner@example.test",
    ownerPassword: PLAINTEXT,
    target: "test",
    ...overrides,
  };
}

interface AdminCreateArgs {
  data: Record<string, unknown>;
}

function fakePrisma(
  options: {
    ownerExists?: boolean;
    requestedEmailExists?: boolean;
  } = {},
) {
  let ownerExists = options.ownerExists ?? false;
  const adminFindFirst = vi.fn(async () =>
    ownerExists ? { id: "existing-owner-id" } : null,
  );
  const adminFindUnique = vi.fn(async () =>
    options.requestedEmailExists ? { id: "existing-manager-id" } : null,
  );
  const adminCreate = vi.fn(async (args: AdminCreateArgs) => {
    ownerExists = true;
    return { id: "created-id", ...args.data };
  });
  const brandCreate = vi.fn();
  const settingsCreate = vi.fn();
  const auditCreate = vi.fn();

  const transactionClient = {
    adminUser: {
      findFirst: adminFindFirst,
      findUnique: adminFindUnique,
      create: adminCreate,
    },
    brand: { create: brandCreate },
    businessSettings: { create: settingsCreate },
    adminAuditLog: { create: auditCreate },
  } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(
    async <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: unknown,
    ) => {
      void options;
      return operation(transactionClient);
    },
  );
  const client = { $transaction: transaction } as unknown as PrismaClient;

  return {
    client,
    transaction,
    adminFindFirst,
    adminFindUnique,
    adminCreate,
    brandCreate,
    settingsCreate,
    auditCreate,
  };
}

describe("createFirstOwner", () => {
  it("hashes the password with real Argon2id and persists only the hash", async () => {
    const fake = fakePrisma();

    expect(await createFirstOwner(fake.client, configuration())).toEqual({
      created: true,
    });
    const data = fake.adminCreate.mock.calls[0]?.[0].data ?? {};
    expect(String(data.passwordHash)).toMatch(/^\$argon2id\$/u);
    expect(data).not.toHaveProperty("password");
    expect(JSON.stringify(data)).not.toContain(PLAINTEXT);
  });

  it("checks owner and email before hashing, then creates the normalized active owner", async () => {
    const fake = fakePrisma();
    const calls: string[] = [];
    fake.adminFindFirst.mockImplementation(async () => {
      calls.push("owner-check");
      return null;
    });
    fake.adminFindUnique.mockImplementation(async () => {
      calls.push("email-check");
      return null;
    });
    const hasher = vi.fn(async () => {
      calls.push("hash");
      return "$argon2id$fake-hash";
    });
    fake.adminCreate.mockImplementation(async (args) => {
      calls.push("insert");
      return { id: "created-id", ...args.data };
    });

    await createFirstOwner(
      fake.client,
      configuration({ ownerEmail: "  Owner@Example.TEST  " }),
      hasher,
    );

    expect(calls).toEqual(["owner-check", "email-check", "hash", "insert"]);
    expect(fake.adminCreate.mock.calls[0]?.[0].data).toMatchObject({
      email: "owner@example.test",
      role: "owner",
      isActive: true,
      mustChangePassword: true,
      passwordHash: "$argon2id$fake-hash",
      name: "owner",
    });
  });

  it("stops successfully and unchanged when any owner already exists", async () => {
    const fake = fakePrisma({ ownerExists: true });
    const hasher = vi.fn(async () => "$argon2id$fake-hash");

    expect(
      await createFirstOwner(fake.client, configuration(), hasher),
    ).toEqual({ created: false });
    expect(fake.adminFindUnique).not.toHaveBeenCalled();
    expect(hasher).not.toHaveBeenCalled();
    expect(fake.adminCreate).not.toHaveBeenCalled();
  });

  it("returns a safe conflict when the requested email belongs to a non-owner", async () => {
    const fake = fakePrisma({ requestedEmailExists: true });
    const hasher = vi.fn(async () => "$argon2id$fake-hash");

    let caught: unknown;
    try {
      await createFirstOwner(fake.client, configuration(), hasher);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SeedConflictError);
    expect(safeSeedErrorMessage(caught)).toBe(
      "Seed conflict: the requested administrator account already exists; no changes made.",
    );
    expect(safeSeedErrorMessage(caught)).not.toContain("example.test");
    expect(hasher).not.toHaveBeenCalled();
    expect(fake.adminCreate).not.toHaveBeenCalled();
  });

  it("uses one serializable transaction and permits at most one insert", async () => {
    const fake = fakePrisma();
    const hasher = vi.fn(async () => "$argon2id$fake-hash");

    expect(
      await createFirstOwner(fake.client, configuration(), hasher),
    ).toEqual({ created: true });
    expect(
      await createFirstOwner(fake.client, configuration(), hasher),
    ).toEqual({ created: false });

    expect(fake.transaction).toHaveBeenCalledTimes(2);
    expect(fake.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
    expect(fake.adminCreate).toHaveBeenCalledTimes(1);
  });

  it("writes no table other than admin_users", async () => {
    const fake = fakePrisma();
    await createFirstOwner(
      fake.client,
      configuration(),
      vi.fn(async () => "$argon2id$fake-hash"),
    );

    expect(fake.adminCreate).toHaveBeenCalledTimes(1);
    expect(fake.brandCreate).not.toHaveBeenCalled();
    expect(fake.settingsCreate).not.toHaveBeenCalled();
    expect(fake.auditCreate).not.toHaveBeenCalled();
  });

  it("never embeds plaintext in a failure or public outcome", async () => {
    const fake = fakePrisma();
    const hasher = vi.fn(async () => {
      throw new Error(`hashing unavailable ${PLAINTEXT}`);
    });

    let caught: unknown;
    try {
      await createFirstOwner(fake.client, configuration(), hasher);
    } catch (error) {
      caught = error;
    }

    expect(safeSeedErrorMessage(caught)).toBe(
      "The seed failed safely without writing data.",
    );
    expect(safeSeedErrorMessage(caught)).not.toContain(PLAINTEXT);
    expect(seedOutcomeMessage({ created: true })).not.toContain(PLAINTEXT);
    expect(fake.adminCreate).not.toHaveBeenCalled();
  });
});

describe("seedOutcomeMessage", () => {
  it("reports created and existing-owner outcomes without account details", () => {
    expect(seedOutcomeMessage({ created: true })).toBe(
      "Seed: owner administrator created.",
    );
    expect(seedOutcomeMessage({ created: false })).toBe(
      "Seed: owner administrator already exists; no changes made.",
    );
  });
});
