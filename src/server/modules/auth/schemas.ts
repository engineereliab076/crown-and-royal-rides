import { z } from "zod";

/**
 * Input validation schemas for authentication.
 *
 * These schemas describe untrusted *input* only. They are intentionally kept
 * separate from Prisma database models and never accept server-controlled
 * columns (`passwordHash`, `sessionVersion`, `isActive`, `createdAt`,
 * `updatedAt`, …): every object schema is `.strict()`, so unknown fields are
 * rejected rather than silently ignored. Error messages are static and never
 * echo a supplied password.
 *
 * This module is pure (no `server-only`, no provider/database/environment
 * access) so it can be reused by the HTTP layer, services, and the seed alike.
 */

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Password policy: minimum 12 characters, matching the seed owner rule. */
export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound to keep hashing input bounded and predictable. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Canonical email normalization: trim surrounding whitespace and lowercase.
 * The seed and services use this so lookups always match the stored CITEXT
 * value consistently; {@link emailSchema} applies the same transform.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** A normalized, structurally-valid email address. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value.length > 0, { message: "Email is required." })
  .refine(
    (value) => value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value),
    { message: "Enter a valid email address." },
  );

/** An administrator's UUID identifier. */
export const adminIdSchema = z.uuid({ message: "Invalid administrator ID." });

/** A new password subject to the account password policy. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  });

/**
 * Login credentials. The password is only checked for presence here — the
 * account policy is enforced when a password is *set*, not when it is used to
 * authenticate, so existing credentials are never rejected by policy drift.
 */
export const loginCredentialsSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, { message: "Password is required." }),
  })
  .strict();

/** A password change: the current password plus a policy-compliant new one. */
export const passwordChangeSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { message: "Current password is required." }),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "New password must be different from the current password.",
    path: ["newPassword"],
  });

export type Email = z.infer<typeof emailSchema>;
export type AdminId = z.infer<typeof adminIdSchema>;
export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;
export type PasswordChange = z.infer<typeof passwordChangeSchema>;
