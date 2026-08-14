import { describe, expect, it, vi } from "vitest";

import {
  createPublicSettingsService,
  toBusinessSettingsPublicDTO,
  type BusinessSettingsPublicDTO,
} from "@/server/modules/settings/public";

const record = {
  businessName: "Crown and Royal Rides",
  whatsappNumber: "+255700000000",
  primaryPhone: "+255700000001",
  secondaryPhone: null,
  email: "hello@example.test",
  address: "Dar es Salaam",
  openingHours: { monday: "09:00-17:00" },
  socialLinks: {},
  heroHeadline: "Find your next vehicle",
  heroSubheadline: "Safe and simple",
};

describe("public business settings", () => {
  it("uses an exact safe allow-list at runtime and serialization", () => {
    const dto = toBusinessSettingsPublicDTO({
      ...record,
      inquiryNotificationEmails: ["private@example.test"],
      updatedById: "private-actor",
      updatedAt: new Date(),
    } as never);
    expect(Object.keys(dto)).toEqual([
      "businessName",
      "whatsappNumber",
      "primaryPhone",
      "secondaryPhone",
      "email",
      "address",
      "openingHours",
      "socialLinks",
      "heroHeadline",
      "heroSubheadline",
    ]);
    const json = JSON.stringify(dto);
    expect(json).not.toContain("inquiryNotificationEmails");
    expect(json).not.toContain("updatedBy");
    expect(json).not.toContain("updatedAt");
  });

  it("loads through the supplied server cache and handles a missing singleton safely", async () => {
    const findPublicSingleton = vi.fn().mockResolvedValue(record);
    const cache = vi.fn(
      async (load: () => Promise<BusinessSettingsPublicDTO>) => load(),
    );
    const service = createPublicSettingsService({
      repository: { findPublicSingleton },
      cache,
    });
    await expect(service.getPublicSettings()).resolves.toMatchObject({
      businessName: record.businessName,
    });
    expect(cache).toHaveBeenCalledTimes(1);
    findPublicSingleton.mockResolvedValueOnce(null);
    await expect(service.getPublicSettings()).rejects.toMatchObject({
      status: 404,
      code: "SETTINGS_NOT_CONFIGURED",
    });
  });
});
