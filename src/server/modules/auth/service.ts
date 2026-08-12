import "server-only";

import type { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import {
  hashPassword as defaultHashPassword,
  verifyPassword as defaultVerifyPassword,
} from "@/server/modules/auth/password";
import type { AuthRepository } from "@/server/modules/auth/repository";
import {
  normalizeEmail,
  passwordChangeSchema,
} from "@/server/modules/auth/schemas";

/**
 * Authentication service.
 *
 * This owns the authoritative authentication business rules: credential
 * verification, database-backed session validation, and password change. It
 * creates no JWTs, sessions, cookies, HTTP responses, or Auth.js callbacks —
 * those live in the Auth.js layer. Dependencies (repository, password verifier,
 * password hasher) are injected so the service is testable in isolation.
 *
 * All login failure modes — unknown email, wrong password, inactive account, or
 * a malformed stored hash — collapse into one identical error so a caller can
 * never tell whether an email is registered.
 */

/** The safe result of a successful credential verification (no `passwordHash`). */
export interface AuthenticatedAdmin {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
}

/** The safe result of a database-validated session (no `passwordHash`). */
export interface ValidatedSession {
  readonly id: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
}

export interface VerifyCredentialsInput {
  readonly email: string;
  readonly password: string;
}

export interface ValidateSessionInput {
  readonly id?: string | null;
  readonly sessionVersion?: number | null;
}

export interface ChangePasswordInput {
  readonly actorId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export type PasswordVerifier = (
  passwordHash: string,
  password: string,
) => Promise<boolean>;

export type PasswordHasher = (password: string) => Promise<string>;

export interface AuthServiceDependencies {
  readonly repository: AuthRepository;
  /** Defaults to the production Argon2id verifier; overridable in tests. */
  readonly verifyPassword?: PasswordVerifier;
  /** Defaults to the production Argon2id hasher; overridable in tests. */
  readonly hashPassword?: PasswordHasher;
}

export interface AuthService {
  verifyCredentials(input: VerifyCredentialsInput): Promise<AuthenticatedAdmin>;
  validateSession(
    input: ValidateSessionInput,
  ): Promise<ValidatedSession | null>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  recordLogin(id: string): Promise<void>;
}

/**
 * A constant, well-formed Argon2id hash of a random throwaway secret. When no
 * active administrator matches, the service still runs a verification against
 * this decoy so the unknown-email and inactive-account paths spend comparable
 * CPU to the wrong-password path. This blunts timing-based user enumeration. It
 * matches no real password and is not a secret.
 */
const DECOY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$6WBfiw1cQgmfFmZknUW3dA$c09wXCpuJ9ivDNiYj1AnwqfjBNsgNSCdIKs8IabBHnw";

function invalidCredentialsError(): AppError {
  return new AppError({
    status: 401,
    code: "AUTH_INVALID_CREDENTIALS",
    message: "Invalid email or password.",
  });
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const { repository } = deps;
  const verifyPassword = deps.verifyPassword ?? defaultVerifyPassword;
  const hashPassword = deps.hashPassword ?? defaultHashPassword;

  return {
    async verifyCredentials(
      input: VerifyCredentialsInput,
    ): Promise<AuthenticatedAdmin> {
      const email = normalizeEmail(input.email);
      const admin = await repository.findCredentialByEmail(email);

      // Verify unconditionally to keep timing uniform. For an unknown or
      // inactive account the decoy hash is used and the result is discarded.
      const hashToCheck =
        admin !== null && admin.isActive
          ? admin.passwordHash
          : DECOY_PASSWORD_HASH;
      const passwordMatches = await verifyPassword(hashToCheck, input.password);

      if (admin === null || !admin.isActive || !passwordMatches) {
        throw invalidCredentialsError();
      }

      return {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword,
        sessionVersion: admin.sessionVersion,
      };
    },

    async validateSession(
      input: ValidateSessionInput,
    ): Promise<ValidatedSession | null> {
      const { id, sessionVersion } = input;
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        typeof sessionVersion !== "number" ||
        !Number.isInteger(sessionVersion)
      ) {
        return null;
      }

      // Exactly one indexed lookup by ID.
      const admin = await repository.findSessionById(id);
      if (admin === null || !admin.isActive) return null;
      if (admin.sessionVersion !== sessionVersion) return null;

      return {
        id: admin.id,
        name: admin.name,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword,
        sessionVersion: admin.sessionVersion,
      };
    },

    async changePassword(input: ChangePasswordInput): Promise<void> {
      // Reject reuse first: the new password must differ from the current one.
      // Because the current password is verified below, differing here means the
      // new password also differs from the stored password.
      if (input.newPassword === input.currentPassword) {
        throw new AppError({
          status: 422,
          code: "PASSWORD_REUSED",
          message: "New password must be different from the current password.",
        });
      }

      const parsed = passwordChangeSchema.safeParse({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
      if (!parsed.success) {
        throw new AppError({
          status: 422,
          code: "WEAK_PASSWORD",
          message: "New password does not meet the requirements.",
        });
      }

      const admin = await repository.findCredentialById(input.actorId);
      if (admin === null || !admin.isActive) {
        throw new AppError({
          status: 401,
          code: "AUTH_REQUIRED",
          message: "Your session is no longer valid.",
        });
      }

      const currentMatches = await verifyPassword(
        admin.passwordHash,
        input.currentPassword,
      );
      if (!currentMatches) {
        throw new AppError({
          status: 400,
          code: "CURRENT_PASSWORD_INVALID",
          message: "Current password is incorrect.",
        });
      }

      const newPasswordHash = await hashPassword(input.newPassword);
      // Atomic: rotate hash, clear forced-change, and bump sessionVersion so the
      // session used to make the change (and any other) is invalidated.
      await repository.changePassword(input.actorId, newPasswordHash);
    },

    async recordLogin(id: string): Promise<void> {
      await repository.recordLogin(id);
    },
  };
}
