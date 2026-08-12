import { AdminRole } from "@/generated/prisma/enums";
import { adminIdSchema, emailSchema } from "@/server/modules/auth/schemas";
import { z } from "zod";

const ADMIN_NAME_MAX_LENGTH = 100;

export const administratorNameSchema = z
  .string()
  .trim()
  .min(2, { message: "Administrator name is required." })
  .max(ADMIN_NAME_MAX_LENGTH, {
    message: `Administrator name must be at most ${ADMIN_NAME_MAX_LENGTH} characters.`,
  });

export const administratorIdSchema = adminIdSchema;

export const administratorParamsSchema = z
  .object({ id: administratorIdSchema })
  .strict();

export const administratorListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    role: z.enum(AdminRole).optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export const createAdministratorSchema = z
  .object({
    email: emailSchema,
    name: administratorNameSchema,
    role: z.enum(AdminRole),
  })
  .strict();

export const setAdministratorRoleSchema = z
  .object({ role: z.enum(AdminRole) })
  .strict();

/** Empty action payload. Strictness rejects actor/server-controlled fields. */
export const administratorActionSchema = z.object({}).strict();

export type AdministratorListInput = z.input<typeof administratorListSchema>;
export type AdministratorListFilters = z.output<typeof administratorListSchema>;
export type CreateAdministratorInput = z.input<
  typeof createAdministratorSchema
>;
export type SetAdministratorRoleInput = z.input<
  typeof setAdministratorRoleSchema
>;
