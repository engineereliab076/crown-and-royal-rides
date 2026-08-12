import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { runInTransaction } from "@/server/db/transaction";
import { createPrismaAuditLogRepository } from "@/server/modules/audit-log/repository";
import { createPrismaSettingsRepository } from "@/server/modules/settings/repository";
import { createSettingsService } from "@/server/modules/settings/service";

import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();
const HASH = "$argon2id$v=19$m=65536,p=4,t=3$fixture$fixture";
const context = { correlationId: "settings-correlation", ipHash: "hashed-ip" };

function client(): PrismaClient {
  return suite.getClient();
}

async function setupRecords() {
  const actor = await client().adminUser.create({
    data: {
      email: "settings-owner@example.test",
      name: "Settings Owner",
      role: AdminRole.owner,
      passwordHash: HASH,
      mustChangePassword: false,
    },
  });
  const settings = await client().businessSettings.create({
    data: {
      id: 1,
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
    },
  });
  return { actor, settings };
}

function service(auditFailsAfterAppend = false) {
  return createSettingsService({
    repository: createPrismaSettingsRepository(client()),
    transaction: async (operation) =>
      runInTransaction(
        async (tx) => {
          const audit = createPrismaAuditLogRepository(tx);
          return operation({
            settings: createPrismaSettingsRepository(tx),
            auditLog: auditFailsAfterAppend
              ? {
                  ...audit,
                  async append(input) {
                    await audit.append(input);
                    throw new Error("deliberate settings audit failure");
                  },
                }
              : audit,
          });
        },
        undefined,
        client(),
      ),
  });
}

describe("settings mutation transactions", () => {
  it("commits one settings update and exactly one safe audit record", async () => {
    const { actor, settings } = await setupRecords();
    const updated = await service().update(
      { id: actor.id, role: AdminRole.owner },
      {
        businessName: "Updated Test Rides",
        whatsappNumber: settings.whatsappNumber,
        primaryPhone: settings.primaryPhone,
        secondaryPhone: settings.secondaryPhone,
        email: settings.email,
        address: settings.address,
        openingHours: settings.openingHours as Record<string, string>,
        socialLinks: settings.socialLinks as Record<string, string>,
        heroHeadline: settings.heroHeadline,
        heroSubheadline: settings.heroSubheadline,
        inquiryNotificationEmails: settings.inquiryNotificationEmails,
      },
      context,
    );

    expect(updated.businessName).toBe("Updated Test Rides");
    const entries = await client().adminAuditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "settings.updated",
      targetType: "business_settings",
      targetId: "1",
      metadata: {
        correlationId: "settings-correlation",
        changedFields: ["businessName"],
      },
    });
    expect(
      JSON.stringify(entries.map(({ metadata }) => metadata)),
    ).not.toContain("Updated Test Rides");
  });

  it("rolls back both settings and audit when audit insertion handling fails", async () => {
    const { actor, settings } = await setupRecords();
    await expect(
      service(true).update(
        { id: actor.id, role: AdminRole.owner },
        {
          businessName: "Must Roll Back",
          whatsappNumber: settings.whatsappNumber,
          primaryPhone: settings.primaryPhone,
          secondaryPhone: settings.secondaryPhone,
          email: settings.email,
          address: settings.address,
          openingHours: settings.openingHours as Record<string, string>,
          socialLinks: settings.socialLinks as Record<string, string>,
          heroHeadline: settings.heroHeadline,
          heroSubheadline: settings.heroSubheadline,
          inquiryNotificationEmails: settings.inquiryNotificationEmails,
        },
        context,
      ),
    ).rejects.toThrow("deliberate settings audit failure");

    expect(
      await client().businessSettings.findUnique({
        where: { id: 1 },
        select: { businessName: true },
      }),
    ).toEqual({ businessName: "Crown Test Rides" });
    expect(await client().adminAuditLog.count()).toBe(0);
  });
});
