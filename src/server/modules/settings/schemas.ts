import { z } from "zod";

import { normalizeTanzanianPhone } from "@/lib/phone";
import { emailSchema } from "@/server/modules/auth/schemas";

const requiredText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} is required.` })
    .max(maximum, { message: `${label} is too long.` });

const phoneSchema = z.string().transform((value, context) => {
  try {
    return normalizeTanzanianPhone(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Enter a valid phone number.",
    });
    return z.NEVER;
  }
});

const optionalPhoneSchema = z
  .union([z.literal(""), phoneSchema, z.null()])
  .transform((value) => (value === "" ? null : value));

export const openingHoursSchema = z.record(
  requiredText("Opening-hours key", 40),
  requiredText("Opening-hours value", 100),
);

export const socialLinksSchema = z.record(
  requiredText("Social-link key", 40),
  z.url({ message: "Social links must be valid URLs." }).max(500),
);

export const updateBusinessSettingsSchema = z
  .object({
    businessName: requiredText("Business name", 120),
    whatsappNumber: phoneSchema,
    primaryPhone: phoneSchema,
    secondaryPhone: optionalPhoneSchema,
    email: emailSchema,
    address: requiredText("Address", 500),
    openingHours: openingHoursSchema,
    socialLinks: socialLinksSchema,
    heroHeadline: requiredText("Hero headline", 160),
    heroSubheadline: requiredText("Hero subheadline", 300),
    inquiryNotificationEmails: z.array(emailSchema).max(20),
  })
  .strict();

export type UpdateBusinessSettingsInput = z.input<
  typeof updateBusinessSettingsSchema
>;
export type NormalizedBusinessSettingsInput = z.output<
  typeof updateBusinessSettingsSchema
>;
