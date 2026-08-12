import { z } from "zod";

export const auditLogListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/, { message: "Invalid audit cursor." })
      .transform((value) => BigInt(value))
      .optional(),
  })
  .strict();

export type AuditLogListInput = z.input<typeof auditLogListSchema>;
