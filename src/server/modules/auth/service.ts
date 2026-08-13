import "server-only";

import type { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import {
  hashPassword as defaultHashPassword,
  verifyPassword as defaultVerifyPassword,
} from "@/server/modules/auth/password";
import type {
  AuthRepository,
  CredentialAdmin,
} from "@/server/modules/auth/repository";
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

/**
 * The internal sub-operation of {@link AuthService.verifyCredentials} that failed
 * *unexpectedly* — distinct from a genuine credential rejection, which always
 * surfaces as the generic `AUTH_INVALID_CREDENTIALS` {@link AppError}. Callers
 * map this to a safe diagnostic substage; the phase name is a fixed, non-sensitive
 * label and the underlying cause is never logged.
 */
export type CredentialVerificationPhase = "repository" | "password" | "record";

/** An unexpected failure of a specific verification sub-operation. */
export class CredentialVerificationError extends Error {
  readonly phase: CredentialVerificationPhase;

  constructor(
    phase: CredentialVerificationPhase,
    options?: { cause?: unknown },
  ) {
    super(`Credential verification failed during the ${phase} phase.`, options);
    this.name = "CredentialVerificationError";
    this.phase = phase;
  }
}

/**
 * Structural validation of a matched, active credential record (never its
 * `passwordHash` content — a malformed hash is handled by the verifier and stays
 * a generic rejection). A record failing these checks indicates internal data
 * corruption rather than a wrong credential.
 */
function isValidCredentialRecord(admin: CredentialAdmin): boolean {
  return (
    typeof admin.id === "string" &&
    admin.id.length > 0 &&
    typeof admin.email === "string" &&
    typeof admin.name === "string" &&
    typeof admin.role === "string" &&
    typeof admin.isActive === "boolean" &&
    typeof admin.mustChangePassword === "boolean" &&
    Number.isInteger(admin.sessionVersion)
  );
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

      // 1) Repository lookup. A missing administrator is a neutral null; only a
      //    thrown database error is an unexpected repository-substage failure.
      let admin: CredentialAdmin | null;
      try {
        admin = await repository.findCredentialByEmail(email);
      } catch (error) {
        throw new CredentialVerificationError("repository", { cause: error });
      }

      // 2) Verify unconditionally to keep timing uniform. For an unknown or
      //    inactive account the decoy hash is used and the result is discarded.
      //    The default verifier never throws (a malformed hash resolves to
      //    false and stays a generic rejection); only an injected/native fault
      //    is an unexpected password-substage failure.
      const hashToCheck =
        admin !== null && admin.isActive
          ? admin.passwordHash
          : DECOY_PASSWORD_HASH;
      let passwordMatches: boolean;
      try {
        passwordMatches = await verifyPassword(hashToCheck, input.password);
      } catch (error) {
        throw new CredentialVerificationError("password", { cause: error });
      }

      if (admin === null || !admin.isActive || !passwordMatches) {
        throw invalidCredentialsError();
      }

      // 3) A matched, active record must be structurally sound before it becomes
      //    an authenticated principal; corruption is an internal record failure,
      //    not a credential rejection.
      if (!isValidCredentialRecord(admin)) {
        throw new CredentialVerificationError("record");
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
