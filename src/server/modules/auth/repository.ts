import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AdminRole } from "@/generated/prisma/enums";

/**
 * Data access for authentication.
 *
 * The repository exposes only the two lookups authentication needs and returns
 * narrow DTOs built with explicit Prisma `select` — never whole Prisma models.
 * It makes no HTTP, Auth.js, cookie, JWT, or provider decision and reads no
 * environment: a missing administrator is a neutral `null`, leaving the caller
 * to decide any response. `passwordHash` is confined to the credential DTO used
 * for verification and is deliberately absent from the session DTO.
 */

/**
 * The fields required to verify a login. `passwordHash` is included here only so
 * the service can verify it; it must never be forwarded into a public DTO.
 */
export interface CredentialAdmin {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly sessionVersion: number;
  readonly mustChangePassword: boolean;
}

/**
 * The fields required to validate an existing session. Notably this excludes
 * `passwordHash`, so session validation can never surface a stored hash.
 */
export interface SessionAdmin {
  readonly id: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly sessionVersion: number;
  readonly mustChangePassword: boolean;
}

/** The result of an atomic password change: only the new session version. */
export interface PasswordChangeResult {
  readonly sessionVersion: number;
}

export interface AuthRepository {
  /** Find an administrator by normalized email for credential verification. */
  findCredentialByEmail(email: string): Promise<CredentialAdmin | null>;
  /** Find an administrator by ID for credential re-verification (password change). */
  findCredentialById(id: string): Promise<CredentialAdmin | null>;
  /** Find an administrator by ID for session validation. */
  findSessionById(id: string): Promise<SessionAdmin | null>;
  /**
   * Atomically rotate an administrator's password: set the new hash, clear the
   * forced-change flag, and increment `sessionVersion` in a single update so any
   * session issued before the change is invalidated. Returns the new version.
   */
  changePassword(
    id: string,
    newPasswordHash: string,
  ): Promise<PasswordChangeResult>;
  /** Best-effort record of a successful login timestamp. */
  recordLogin(id: string): Promise<void>;
}

/**
 * The minimal Prisma surface this repository depends on. Declaring it as a
 * narrow `Pick` lets tests inject a typed fake `adminUser` delegate without
 * constructing a real client.
 */
export type AuthPrismaClient = Pick<PrismaClient, "adminUser">;

const CREDENTIAL_SELECT = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  role: true,
  isActive: true,
  sessionVersion: true,
  mustChangePassword: true,
} as const;

const SESSION_SELECT = {
  id: true,
  name: true,
  role: true,
  isActive: true,
  sessionVersion: true,
  mustChangePassword: true,
} as const;

const PASSWORD_CHANGE_SELECT = {
  sessionVersion: true,
} as const;

/**
 * Build an {@link AuthRepository} backed by an injected Prisma client. The
 * application singleton is passed in by the caller (never imported here), so
 * this module has no import-time side effects and stays trivially testable.
 */
export function createPrismaAuthRepository(
  client: AuthPrismaClient,
): AuthRepository {
  return {
    async findCredentialByEmail(
      email: string,
    ): Promise<CredentialAdmin | null> {
      return client.adminUser.findUnique({
        where: { email },
        select: CREDENTIAL_SELECT,
      });
    },
    async findCredentialById(id: string): Promise<CredentialAdmin | null> {
      return client.adminUser.findUnique({
        where: { id },
        select: CREDENTIAL_SELECT,
      });
    },
    async findSessionById(id: string): Promise<SessionAdmin | null> {
      return client.adminUser.findUnique({
        where: { id },
        select: SESSION_SELECT,
      });
    },
    async changePassword(
      id: string,
      newPasswordHash: string,
    ): Promise<PasswordChangeResult> {
      return client.adminUser.update({
        where: { id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          sessionVersion: { increment: 1 },
        },
        select: PASSWORD_CHANGE_SELECT,
      });
    },
    async recordLogin(id: string): Promise<void> {
      await client.adminUser.update({
        where: { id },
        data: { lastLoginAt: new Date() },
        select: { id: true },
      });
    },
  };
}
