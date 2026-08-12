import { describe, expect, it, vi } from "vitest";

import {
  createPrismaSettingsRepository,
  type SettingsPrismaClient,
} from "@/server/modules/settings/repository";

describe("Prisma settings repository", () => {
  it("reads only the singleton public fields", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repository = createPrismaSettingsRepository({
      businessSettings: { findUnique },
    } as unknown as SettingsPrismaClient);
    await repository.findSingleton();
    const args = findUnique.mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 1 });
    expect(args.select).not.toHaveProperty("id");
    expect(args.select).not.toHaveProperty("updatedBy");
  });

  it("updates only id=1 with an explicit safe select", async () => {
    const update = vi.fn().mockResolvedValue({});
    const repository = createPrismaSettingsRepository({
      businessSettings: { update },
    } as unknown as SettingsPrismaClient);
    const input = {
      businessName: "Test",
      whatsappNumber: "+255712345678",
      primaryPhone: "+255712345678",
      secondaryPhone: null,
      email: "test@example.test",
      address: "Test address",
      openingHours: {},
      socialLinks: {},
      heroHeadline: "Headline",
      heroSubheadline: "Subheadline",
      inquiryNotificationEmails: [],
      updatedById: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    };
    await repository.updateSingleton(input);
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 1 },
      data: input,
    });
    expect(update.mock.calls[0]?.[0].select).not.toHaveProperty("id");
  });
});
