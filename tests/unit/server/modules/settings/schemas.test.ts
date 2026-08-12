import { describe, expect, it } from "vitest";

import { updateBusinessSettingsSchema } from "@/server/modules/settings/schemas";

export const VALID_SETTINGS_INPUT = {
  businessName: "Crown Test Rides",
  whatsappNumber: "0712345678",
  primaryPhone: "+255712345678",
  secondaryPhone: "",
  email: "hello@example.test",
  address: "Test address",
  openingHours: { monday: "08:00-17:00" },
  socialLinks: { instagram: "https://example.test/social" },
  heroHeadline: "Test headline",
  heroSubheadline: "Test subheadline",
  inquiryNotificationEmails: ["inquiries@example.test"],
};

describe("business settings schema", () => {
  it("normalizes phone numbers and optional secondary phone", () => {
    expect(
      updateBusinessSettingsSchema.parse(VALID_SETTINGS_INPUT),
    ).toMatchObject({
      whatsappNumber: "+255712345678",
      primaryPhone: "+255712345678",
      secondaryPhone: null,
    });
  });

  it.each(["id", "updatedAt", "updatedById"])(
    "rejects the server-controlled field %s",
    (field) => {
      expect(
        updateBusinessSettingsSchema.safeParse({
          ...VALID_SETTINGS_INPUT,
          [field]: "attacker-controlled",
        }).success,
      ).toBe(false);
    },
  );
});
