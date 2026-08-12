import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import type {
  AppendAuditRecord,
  AuditLogRepository,
} from "@/server/modules/audit-log/repository";
import type {
  AdministratorRepository,
  CreateAdministratorRecord,
  PublicAdministrator,
} from "@/server/modules/administrators/repository";
import type { AdministratorRateLimiter } from "@/server/modules/administrators/rate-limit";
import {
  ADMIN_AUDIT_ACTIONS,
  type AdministratorTransactionRunner,
  createAdministratorService,
} from "@/server/modules/administrators/service";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TARGET_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OTHER_OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const context = { correlationId: "correlation-123", ipHash: "hashed-ip" };
const owner = { id: OWNER_ID, role: AdminRole.owner };
const manager = { id: OWNER_ID, role: AdminRole.manager };

function admin(
  id: string,
  overrides: Partial<PublicAdministrator> = {},
): PublicAdministrator {
  return {
    id,
    email: `${id.slice(-1)}@example.com`,
    name: "Test Admin",
    role: AdminRole.manager,
    isActive: true,
    mustChangePassword: false,
    sessionVersion: 1,
    lastLoginAt: null,
    createdById: OWNER_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

class FakeAdministratorRepository implements AdministratorRepository {
  readonly records = new Map<string, PublicAdministrator>();
  readonly passwordHashes = new Map<string, string>();
  creates = 0;
  mutations = 0;

  constructor(records: readonly PublicAdministrator[]) {
    for (const record of records) this.records.set(record.id, record);
  }

  async list(input: { page: number; limit: number }) {
    return {
      items: [...this.records.values()],
      page: input.page,
      limit: input.limit,
      total: this.records.size,
    };
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async findByEmail(email: string) {
    return (
      [...this.records.values()].find((row) => row.email === email) ?? null
    );
  }
  async create(input: CreateAdministratorRecord) {
    this.creates += 1;
    this.passwordHashes.set(TARGET_ID, input.passwordHash);
    const record = admin(TARGET_ID, {
      email: input.email,
      name: input.name,
      role: input.role,
      mustChangePassword: true,
      createdById: input.createdById,
    });
    this.records.set(record.id, record);
    return record;
  }
  async setRole(id: string, role: AdminRole) {
    return this.update(id, {
      role,
      sessionVersion: this.required(id).sessionVersion + 1,
    });
  }
  async deactivate(id: string) {
    return this.update(id, {
      isActive: false,
      sessionVersion: this.required(id).sessionVersion + 1,
    });
  }
  async reactivate(id: string) {
    return this.update(id, { isActive: true });
  }
  async resetPassword(id: string, passwordHash: string) {
    this.passwordHashes.set(id, passwordHash);
    return this.update(id, {
      mustChangePassword: true,
      sessionVersion: this.required(id).sessionVersion + 1,
    });
  }
  async lockActiveOwners() {
    return [...this.records.values()]
      .filter((row) => row.role === AdminRole.owner && row.isActive)
      .map(({ id }) => ({ id }));
  }
  private required(id: string) {
    const record = this.records.get(id);
    if (!record) throw new Error("missing fake record");
    return record;
  }
  private update(id: string, changes: Partial<PublicAdministrator>) {
    this.mutations += 1;
    const updated = { ...this.required(id), ...changes };
    this.records.set(id, updated);
    return updated;
  }
}

class FakeAuditRepository implements AuditLogRepository {
  readonly appended: AppendAuditRecord[] = [];
  async append(input: AppendAuditRecord) {
    this.appended.push(input);
    return {
      id: BigInt(this.appended.length),
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata as Prisma.JsonValue,
      ipHash: input.ipHash,
      createdAt: new Date(),
    };
  }
  async list() {
    return { items: [], nextCursor: null };
  }
}

function harness(records: readonly PublicAdministrator[]) {
  const repository = new FakeAdministratorRepository(records);
  const auditLog = new FakeAuditRepository();
  const generateTemporaryPassword = vi.fn(() => "Temporary-Password-9!");
  const hashPassword = vi.fn(async () => "$argon2id$stored-hash");
  const rateLimiter = {
    checkPasswordReset: vi
      .fn<AdministratorRateLimiter["checkPasswordReset"]>()
      .mockResolvedValue({ allowed: true }),
  };
  const service = createAdministratorService({
    repository,
    rateLimiter,
    generateTemporaryPassword,
    hashPassword,
    transaction: async (operation) =>
      operation({ administrators: repository, auditLog }),
  });
  return {
    service,
    repository,
    auditLog,
    generateTemporaryPassword,
    hashPassword,
    rateLimiter,
  };
}

async function rejectedCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as AppError).code;
  }
  throw new Error("Expected rejection");
}

describe("administrator service authorization", () => {
  it("denies managers before every operation can mutate", async () => {
    const h = harness([admin(TARGET_ID)]);
    const calls = [
      h.service.list(manager, {}),
      h.service.createAdmin(
        manager,
        {
          email: "new@example.com",
          name: "New Admin",
          role: AdminRole.manager,
        },
        context,
      ),
      h.service.setRole(manager, TARGET_ID, { role: AdminRole.owner }, context),
      h.service.deactivate(manager, TARGET_ID, context),
      h.service.reactivate(manager, TARGET_ID, context),
      h.service.resetPassword(manager, TARGET_ID, context),
    ];
    await Promise.all(
      calls.map(async (call) =>
        expect(await rejectedCode(call)).toBe("FORBIDDEN"),
      ),
    );
    expect(h.repository.creates).toBe(0);
    expect(h.repository.mutations).toBe(0);
    expect(h.auditLog.appended).toHaveLength(0);
    expect(h.generateTemporaryPassword).not.toHaveBeenCalled();
  });
});

describe("administrator service behavior and auditing", () => {
  it("lists only public administrator fields", async () => {
    const h = harness([admin(TARGET_ID)]);
    const result = await h.service.list(owner, {});
    expect(result.items[0]).not.toHaveProperty("passwordHash");
  });

  it("creates a normalized active administrator with a one-time temporary password", async () => {
    const h = harness([]);
    const result = await h.service.createAdmin(
      owner,
      {
        email: "  New@Example.COM ",
        name: " New Admin ",
        role: AdminRole.manager,
      },
      context,
    );
    expect(result.temporaryPassword).toBe("Temporary-Password-9!");
    expect(result.administrator.email).toBe("new@example.com");
    expect(result.administrator.mustChangePassword).toBe(true);
    expect(result.administrator).not.toHaveProperty("passwordHash");
    expect(h.repository.passwordHashes.get(TARGET_ID)).toBe(
      "$argon2id$stored-hash",
    );
    expect(JSON.stringify(h.auditLog.appended)).not.toContain(
      "Temporary-Password-9!",
    );
    expect(JSON.stringify(h.auditLog.appended)).not.toContain(
      "$argon2id$stored-hash",
    );
    expect(h.auditLog.appended[0]?.action).toBe(ADMIN_AUDIT_ACTIONS.created);
  });

  it("fails duplicate normalized email safely before generation", async () => {
    const h = harness([admin(TARGET_ID, { email: "new@example.com" })]);
    expect(
      await rejectedCode(
        h.service.createAdmin(
          owner,
          {
            email: " NEW@example.com ",
            name: "New Admin",
            role: AdminRole.manager,
          },
          context,
        ),
      ),
    ).toBe("ADMIN_EMAIL_EXISTS");
    expect(h.generateTemporaryPassword).not.toHaveBeenCalled();
    expect(h.auditLog.appended).toHaveLength(0);
  });

  it("changes role and deactivates with version invalidation and one safe audit each", async () => {
    const h = harness([
      admin(OWNER_ID, { role: AdminRole.owner }),
      admin(TARGET_ID, { sessionVersion: 4 }),
    ]);
    const promoted = await h.service.setRole(
      owner,
      TARGET_ID,
      { role: AdminRole.owner },
      context,
    );
    expect(promoted.sessionVersion).toBe(5);
    const deactivated = await h.service.deactivate(owner, TARGET_ID, context);
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.sessionVersion).toBe(6);
    expect(h.auditLog.appended.map((row) => row.action)).toEqual([
      ADMIN_AUDIT_ACTIONS.roleChanged,
      ADMIN_AUDIT_ACTIONS.deactivated,
    ]);
  });

  it("reactivates without weakening the previous session invalidation", async () => {
    const h = harness([
      admin(TARGET_ID, { isActive: false, sessionVersion: 8 }),
    ]);
    const result = await h.service.reactivate(owner, TARGET_ID, context);
    expect(result.isActive).toBe(true);
    expect(result.sessionVersion).toBe(8);
    expect(h.auditLog.appended[0]?.action).toBe(
      ADMIN_AUDIT_ACTIONS.reactivated,
    );
  });

  it("resets password, requires change, increments version, and never persists plaintext", async () => {
    const h = harness([admin(TARGET_ID, { sessionVersion: 2 })]);
    const result = await h.service.resetPassword(owner, TARGET_ID, context);
    expect(result.temporaryPassword).toBe("Temporary-Password-9!");
    expect(result.administrator.sessionVersion).toBe(3);
    expect(result.administrator.mustChangePassword).toBe(true);
    expect(h.repository.passwordHashes.get(TARGET_ID)).toBe(
      "$argon2id$stored-hash",
    );
    expect(JSON.stringify(h.auditLog.appended)).not.toContain(
      "Temporary-Password-9!",
    );
    expect(JSON.stringify(h.auditLog.appended)).not.toContain("argon2id");
  });

  it("fails closed before generation, hashing, persistence, or audit", async () => {
    const h = harness([admin(TARGET_ID)]);
    h.rateLimiter.checkPasswordReset.mockResolvedValue({ allowed: false });
    expect(
      await rejectedCode(h.service.resetPassword(owner, TARGET_ID, context)),
    ).toBe("RATE_LIMITED");
    expect(h.generateTemporaryPassword).not.toHaveBeenCalled();
    expect(h.hashPassword).not.toHaveBeenCalled();
    expect(h.repository.mutations).toBe(0);
    expect(h.auditLog.appended).toHaveLength(0);
  });

  it("protects the last active owner", async () => {
    const h = harness([admin(TARGET_ID, { role: AdminRole.owner })]);
    expect(
      await rejectedCode(h.service.deactivate(owner, TARGET_ID, context)),
    ).toBe("LAST_ACTIVE_OWNER");
    expect(
      await rejectedCode(
        h.service.setRole(
          owner,
          TARGET_ID,
          { role: AdminRole.manager },
          context,
        ),
      ),
    ).toBe("LAST_ACTIVE_OWNER");
    expect(h.auditLog.appended).toHaveLength(0);
  });

  it("treats role and status no-ops deliberately without misleading audits", async () => {
    const h = harness([
      admin(OWNER_ID, { role: AdminRole.owner }),
      admin(OTHER_OWNER_ID, { role: AdminRole.owner }),
      admin(TARGET_ID, { role: AdminRole.manager, isActive: true }),
    ]);
    await h.service.setRole(
      owner,
      TARGET_ID,
      { role: AdminRole.manager },
      context,
    );
    await h.service.reactivate(owner, TARGET_ID, context);
    expect(h.repository.mutations).toBe(0);
    expect(h.auditLog.appended).toHaveLength(0);
  });

  it("retries only a recognized adapter-wrapped serialization conflict", async () => {
    const h = harness([
      admin(OWNER_ID, { role: AdminRole.owner }),
      admin(TARGET_ID, { role: AdminRole.manager }),
    ]);
    let attempts = 0;
    const transaction: AdministratorTransactionRunner = async (operation) => {
      attempts += 1;
      if (attempts === 1) {
        throw {
          code: "P2010",
          meta: {
            driverAdapterError: { cause: { originalCode: "40001" } },
          },
        };
      }
      return operation({
        administrators: h.repository,
        auditLog: h.auditLog,
      });
    };
    const service = createAdministratorService({
      repository: h.repository,
      rateLimiter: h.rateLimiter,
      transaction,
      generateTemporaryPassword: h.generateTemporaryPassword,
      hashPassword: h.hashPassword,
    });

    await expect(
      service.setRole(owner, TARGET_ID, { role: AdminRole.owner }, context),
    ).resolves.toMatchObject({ role: AdminRole.owner, sessionVersion: 2 });
    expect(attempts).toBe(2);
    expect(h.auditLog.appended).toHaveLength(1);
  });
});
