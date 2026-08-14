import { z } from "zod";

export function normalizeBrandName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const brandNameSchema = z
  .string()
  .transform(normalizeBrandName)
  .pipe(z.string().min(1).max(80));
const logoUrlSchema = z
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "Logo URL must use HTTPS.",
  )
  .nullable()
  .optional();

export const createBrandSchema = z
  .object({
    name: brandNameSchema,
    logoUrl: logoUrlSchema,
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const updateBrandSchema = z
  .object({
    name: brandNameSchema.optional(),
    logoUrl: logoUrlSchema,
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one brand field is required.",
  );

export const brandParamsSchema = z.object({ id: z.uuid() }).strict();
export type CreateBrandInput = z.input<typeof createBrandSchema>;
export type UpdateBrandInput = z.input<typeof updateBrandSchema>;
