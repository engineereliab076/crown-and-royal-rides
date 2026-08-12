import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import type {
  AppendAuditRecord,
  AuditLogRepository,
} from "@/server/modules/audit-log/repository";
import type {
  PublicBusinessSettings,
  SettingsRepository,
  UpdateBusinessSettingsRecord,
} from "@/server/modules/settings/repository";
import {
  createSettingsService,
  SETTINGS_AUDIT_ACTION,
} from "@/server/modules/settings/service";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const context = { correlationId: "correlation-123", ipHash: "hashed-ip" };

const CURRENT: PublicBusinessSettings = {
  businessName: "Crown Test Rides",
  whatsappNumber: "+255712345678",
  primaryPhone: "+255712345678",
  secondaryPhone: null,
  email: "hello@example.test",
  address: "Test address",
  openingHours: { monday: "08:00-17:00" },
  socialLinks: { instagram: "https://example.test/social" },
  heroHeadline: "Test headline",
  heroSubheadline: "Test subheadline",
  inquiryNotificationEmails: ["inquiries@example.test"],
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  updatedById: null,
};

const INPUT = {
  businessName: CURRENT.businessName,
  whatsappNumber: CURRENT.whatsappNumber,
  primaryPhone: CURRENT.primaryPhone,
  secondaryPhone: CURRENT.secondaryPhone,
  email: CURRENT.email,
  address: CURRENT.address,
  openingHours: CURRENT.openingHours as Record<string, string>,
  socialLinks: CURRENT.socialLinks as Record<string, string>,
  heroHeadline: CURRENT.heroHeadline,
  heroSubheadline: CURRENT.heroSubheadline,
  inquiryNotificationEmails: [...CURRENT.inquiryNotificationEmails],
};

class FakeSettingsRepository implements SettingsRepository {
  current: PublicBusinessSettings | null;
  updates = 0;

  constructor(current: PublicBusinessSettings | null = CURRENT) {
    this.current = current;
  }

  async findSingleton() {
    return this.current;
  }

  async updateSingleton(input: UpdateBusinessSettingsRecord) {
    this.updates += 1;
    if (this.current === null) throw new Error("missing settings");
    this.current = {
      ...this.current,
      ...input,
      openingHours: input.openingHours as Prisma.JsonValue,
      socialLinks: input.socialLinks as Prisma.JsonValue,
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    return this.current;
  }
}

class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: AppendAuditRecord[] = [];
  async append(input: AppendAuditRecord) {
    this.entries.push(input);
    return {
      ...input,
      id: BigInt(this.entries.length),
      metadata: input.metadata as Prisma.JsonValue,
      createdAt: new Date(),
    };
  }
  async list() {
    return { items: [], nextCursor: null };
  }
}

function harness(current: PublicBusinessSettings | null = CURRENT) {
  const repository = new FakeSettingsRepository(current);
  const auditLog = new FakeAuditLogRepository();
  const transaction = vi.fn(async (operation) =>
    operation({ settings: repository, auditLog }),
  );
  return {
    repository,
    auditLog,
    transaction,
    service: createSettingsService({ repository, transaction }),
  };
}

describe("settings service", () => {
  it("allows an owner to read and update settings", async () => {
    const h = harness();
    const actor = { id: OWNER_ID, role: AdminRole.owner };
    await expect(h.service.get(actor)).resolves.toEqual(CURRENT);
    const updated = await h.service.update(
      actor,
      { ...INPUT, businessName: "Updated Test Rides" },
      context,
    );
    expect(updated.businessName).toBe("Updated Test Rides");
    expect(h.repository.updates).toBe(1);
  });

  it("refuses a manager before repository, transaction, or audit access", async () => {
    const h = harness();
    await expect(
      h.service.update(
        { id: OWNER_ID, role: AdminRole.manager },
        INPUT,
        context,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.repository.updates).toBe(0);
    expect(h.auditLog.entries).toHaveLength(0);
  });

  it("writes exactly one audit entry containing changed field names only", async () => {
    const h = harness();
    await h.service.update(
      { id: OWNER_ID, role: AdminRole.owner },
      { ...INPUT, heroHeadline: "Updated headline", email: "new@example.test" },
      context,
    );
    expect(h.auditLog.entries).toHaveLength(1);
    expect(h.auditLog.entries[0]).toMatchObject({
      action: SETTINGS_AUDIT_ACTION,
      targetType: "business_settings",
      targetId: "1",
      metadata: {
        correlationId: "correlation-123",
        changedFields: ["email", "heroHeadline"],
      },
    });
    const auditText = JSON.stringify(h.auditLog.entries);
    expect(auditText).not.toContain("Updated headline");
    expect(auditText).not.toContain("new@example.test");
  });

  it("returns a no-op without update or misleading audit", async () => {
    const h = harness();
    await h.service.update(
      { id: OWNER_ID, role: AdminRole.owner },
      INPUT,
      context,
    );
    expect(h.repository.updates).toBe(0);
    expect(h.auditLog.entries).toHaveLength(0);
  });

  it("does not enter a transaction for invalid input", async () => {
    const h = harness();
    await expect(
      h.service.update(
        { id: OWNER_ID, role: AdminRole.owner },
        { ...INPUT, id: 1 } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.auditLog.entries).toHaveLength(0);
  });
});
