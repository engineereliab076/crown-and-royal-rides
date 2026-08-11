import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  describeDatabaseError,
  postgresErrorCode,
  prismaErrorCode,
} from "../support/errors";
import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Constraint and default behavior of the `0001_foundation` schema, proven with
 * inserts against the real test database. Every value below is obviously fake.
 */

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

// A fake Argon2id-shaped string; no real hashing is performed in this phase.
const FAKE_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$abcdefghijklmnop$0123456789abcdefghijklmnopqrstuvwxyzABCDEF01";

function adminInput(overrides: {
  email: string;
  name?: string;
  createdById?: string | null;
}) {
  return {
    email: overrides.email,
    passwordHash: FAKE_PASSWORD_HASH,
    name: overrides.name ?? "Fake Admin",
    role: "owner" as const,
    ...(overrides.createdById !== undefined
      ? { createdById: overrides.createdById }
      : {}),
  };
}

function businessSettingsInput(overrides: {
  id: number;
  updatedById?: string | null;
  inquiryNotificationEmails?: string[];
}) {
  return {
    id: overrides.id,
    businessName: "Fake Rides Ltd",
    whatsappNumber: "+255700000000",
    primaryPhone: "+255700000001",
    email: "info@fake.example",
    address: "1 Fake Street",
    openingHours: { mon: "08:00-17:00" },
    socialLinks: { instagram: "fake" },
    heroHeadline: "Fake headline",
    heroSubheadline: "Fake subheadline",
    inquiryNotificationEmails: overrides.inquiryNotificationEmails ?? [
      "notify@fake.example",
    ],
    ...(overrides.updatedById !== undefined
      ? { updatedById: overrides.updatedById }
      : {}),
  };
}

describe("business_settings singleton constraint", () => {
  it("accepts the single row id = 1", async () => {
    const created = await client().businessSettings.create({
      data: businessSettingsInput({ id: 1 }),
    });
    expect(created.id).toBe(1);
  });

  it("rejects id = 2 via business_settings_singleton_check", async () => {
    await client().businessSettings.create({
      data: businessSettingsInput({ id: 1 }),
    });

    let caught: unknown;
    try {
      await client().businessSettings.create({
        data: businessSettingsInput({ id: 2 }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(describeDatabaseError(caught)).toContain(
      "business_settings_singleton_check",
    );
  });
});

describe("brand uniqueness", () => {
  it("accepts a first brand", async () => {
    const brand = await client().brand.create({
      data: { name: "Fake Motors", slug: "fake-motors", sortOrder: 1 },
    });
    expect(brand.name).toBe("Fake Motors");
  });

  it("rejects a duplicate name", async () => {
    await client().brand.create({
      data: { name: "Fake Motors", slug: "fake-motors", sortOrder: 1 },
    });

    let caught: unknown;
    try {
      await client().brand.create({
        data: { name: "Fake Motors", slug: "other-slug", sortOrder: 2 },
      });
    } catch (error) {
      caught = error;
    }

    expect(prismaErrorCode(caught)).toBe("P2002");
    expect(describeDatabaseError(caught)).toContain("brands_name_key");
  });

  it("rejects a duplicate slug", async () => {
    await client().brand.create({
      data: { name: "Fake Motors", slug: "fake-motors", sortOrder: 1 },
    });

    let caught: unknown;
    try {
      await client().brand.create({
        data: { name: "Other Motors", slug: "fake-motors", sortOrder: 2 },
      });
    } catch (error) {
      caught = error;
    }

    expect(prismaErrorCode(caught)).toBe("P2002");
    expect(describeDatabaseError(caught)).toContain("brands_slug_key");
  });

  it("accepts distinct name and slug", async () => {
    await client().brand.create({
      data: { name: "Fake Motors", slug: "fake-motors", sortOrder: 1 },
    });
    const second = await client().brand.create({
      data: { name: "Royal Motors", slug: "royal-motors", sortOrder: 2 },
    });
    expect(second.slug).toBe("royal-motors");
  });
});

describe("admin_users email CITEXT uniqueness", () => {
  it("treats emails case-insensitively as duplicates", async () => {
    await client().adminUser.create({
      data: adminInput({ email: "Owner@Example.com" }),
    });

    let caught: unknown;
    try {
      await client().adminUser.create({
        data: adminInput({ email: "owner@example.com" }),
      });
    } catch (error) {
      caught = error;
    }

    expect(prismaErrorCode(caught)).toBe("P2002");
    expect(describeDatabaseError(caught)).toContain("admin_users_email_key");
  });
});

describe("foreign-key SET NULL on administrator deletion", () => {
  it("nulls admin_users.created_by", async () => {
    const creator = await client().adminUser.create({
      data: adminInput({ email: "creator@fake.example" }),
    });
    const created = await client().adminUser.create({
      data: adminInput({
        email: "created@fake.example",
        createdById: creator.id,
      }),
    });

    await client().adminUser.delete({ where: { id: creator.id } });

    const reloaded = await client().adminUser.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(reloaded.createdById).toBeNull();
  });

  it("nulls admin_audit_log.actor_id", async () => {
    const actor = await client().adminUser.create({
      data: adminInput({ email: "actor@fake.example" }),
    });
    const entry = await client().adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: "test.action",
        targetType: "brand",
        targetId: "fake-target",
        ipHash: "fakehash",
      },
    });

    await client().adminUser.delete({ where: { id: actor.id } });

    const reloaded = await client().adminAuditLog.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.actorId).toBeNull();
  });

  it("nulls business_settings.updated_by", async () => {
    const editor = await client().adminUser.create({
      data: adminInput({ email: "editor@fake.example" }),
    });
    await client().businessSettings.create({
      data: businessSettingsInput({ id: 1, updatedById: editor.id }),
    });

    await client().adminUser.delete({ where: { id: editor.id } });

    const reloaded = await client().businessSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(reloaded.updatedById).toBeNull();
  });
});

describe("column defaults", () => {
  it("applies administrator defaults", async () => {
    const admin = await client().adminUser.create({
      data: adminInput({ email: "defaults@fake.example" }),
    });

    expect(admin.isActive).toBe(true);
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.sessionVersion).toBe(1);
    expect(admin.createdAt).toBeInstanceOf(Date);
    expect(admin.updatedAt).toBeInstanceOf(Date);
  });

  it("defaults media_deletion_queue.attempts to 0", async () => {
    const queued = await client().mediaDeletionQueue.create({
      data: { publicId: "fake/public-id", ownerType: "brand" },
    });
    expect(queued.attempts).toBe(0);
    expect(queued.createdAt).toBeInstanceOf(Date);
  });

  it("defaults admin_audit_log.metadata to an empty object", async () => {
    const entry = await client().adminAuditLog.create({
      data: {
        action: "test.action",
        targetType: "brand",
        targetId: "fake-target",
        ipHash: "fakehash",
      },
    });
    expect(entry.metadata).toEqual({});
    expect(entry.createdAt).toBeInstanceOf(Date);
  });
});

describe("inquiry_notification_emails array behavior", () => {
  it("is a NOT NULL ARRAY column", async () => {
    interface ColumnRow {
      data_type: string;
      is_nullable: string;
    }
    const rows = await client().$queryRawUnsafe<ColumnRow[]>(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'business_settings'
         AND column_name = 'inquiry_notification_emails'`,
    );
    expect(rows).toHaveLength(1);
    // The column is a required list: an empty array means "no recipients"; NULL
    // is meaningless and forbidden. The migration enforces NOT NULL by hand
    // because Prisma renders a required String[] as a nullable column.
    expect(rows[0]?.data_type).toBe("ARRAY");
    expect(rows[0]?.is_nullable).toBe("NO");
  });

  it("accepts an empty list", async () => {
    const settings = await client().businessSettings.create({
      data: businessSettingsInput({ id: 1, inquiryNotificationEmails: [] }),
    });
    expect(settings.inquiryNotificationEmails).toEqual([]);
  });

  it("round-trips provided values", async () => {
    const settings = await client().businessSettings.create({
      data: businessSettingsInput({
        id: 1,
        inquiryNotificationEmails: ["a@fake.example", "b@fake.example"],
      }),
    });
    expect(settings.inquiryNotificationEmails).toEqual([
      "a@fake.example",
      "b@fake.example",
    ]);
  });

  it("rejects a raw NULL write with a not-null violation (SQLSTATE 23502)", async () => {
    // Seed the single valid row, then attempt a raw NULL write that bypasses
    // Prisma's type system — the database NOT NULL constraint must reject it.
    await client().businessSettings.create({
      data: businessSettingsInput({ id: 1, inquiryNotificationEmails: [] }),
    });

    let caught: unknown;
    try {
      await client().$executeRawUnsafe(
        `UPDATE business_settings SET inquiry_notification_emails = NULL WHERE id = 1`,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(postgresErrorCode(caught)).toBe("23502");
    expect(describeDatabaseError(caught)).toContain(
      "inquiry_notification_emails",
    );
  });
});
