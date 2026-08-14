import { z } from "zod";

import { normalizeTanzanianPhone } from "@/lib/phone";

const CUSTOMER_NAME_MAX_LENGTH = 120;
const MESSAGE_MAX_LENGTH = 2000;

export const purchaseInquirySchema = z
  .object({
    vehicleId: z.uuid({ message: "Select a valid vehicle." }),
    customerName: z
      .string()
      .trim()
      .min(2, { message: "Name is required." })
      .max(CUSTOMER_NAME_MAX_LENGTH, {
        message: `Name must be at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`,
      }),
    customerPhone: z.string().transform((value, context) => {
      try {
        return normalizeTanzanianPhone(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Enter a valid Tanzanian phone number.",
        });
        return z.NEVER;
      }
    }),
    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email({ message: "Enter a valid email address." })
      .max(254)
      .optional(),
    message: z.string().trim().max(MESSAGE_MAX_LENGTH).optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    customerEmail:
      value.customerEmail === undefined || value.customerEmail.length === 0
        ? undefined
        : value.customerEmail,
    message:
      value.message === undefined || value.message.length === 0
        ? undefined
        : value.message,
  }));

export type PurchaseInquiryInput = z.input<typeof purchaseInquirySchema>;
export type PurchaseInquiryData = z.output<typeof purchaseInquirySchema>;

export const adminInquiryListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type AdminInquiryListInput = z.input<typeof adminInquiryListQuerySchema>;
export type AdminInquiryListQuery = z.output<
  typeof adminInquiryListQuerySchema
>;
