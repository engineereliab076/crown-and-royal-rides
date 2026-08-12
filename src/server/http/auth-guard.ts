import "server-only";

import type { Session } from "next-auth";

import { AppError } from "@/server/http/errors";
import {
  type AuthenticatedActor,
  type Capability,
  requireCapability,
} from "@/server/modules/auth/capabilities";

/**
 * Route-handler authentication guard.
 *
 * These helpers resolve the database-validated Auth.js session (never trusting
 * role or administrator ID from the request body, query string, or headers),
 * build the service-layer actor, enforce the forced-password-change
 * restriction, and optionally check a capability. Failures throw the standard
 * {@link AppError} (401 / 403) that `withRouteHandler` renders safely.
 *
 * The guard is a convenience for route handlers; services must still perform
 * their own authoritative `requireCapability` checks for business operations.
 */

export interface AdminPrincipal {
  readonly actor: AuthenticatedActor;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
}

export interface RequireAdminOptions {
  /** When set, the actor must hold this capability (else 403). */
  readonly capability?: Capability;
  /**
   * When true, an administrator with `mustChangePassword` is still allowed.
   * Defaults to false so forced-change users are blocked from every protected
   * operation except the change-password flow itself.
   */
  readonly allowForcedPasswordChange?: boolean;
}

export type SessionResolver = () => Promise<Session | null>;

function authRequired(): AppError {
  return new AppError({
    status: 401,
    code: "AUTH_REQUIRED",
    message: "Authentication required.",
  });
}

/**
 * Require an authenticated, database-validated administrator. Returns the
 * principal on success; throws {@link AppError} otherwise. A custom session
 * resolver may be injected for tests; by default the Auth.js `auth()` (which
 * runs the DB-validating session callback) is used.
 */
export async function requireAdmin(
  options: RequireAdminOptions = {},
  resolveSession?: SessionResolver,
): Promise<AdminPrincipal> {
  // The Auth.js `auth()` (and its Prisma-backed session callback) is imported
  // lazily so this module stays free of import-time side effects and is trivial
  // to unit test with an injected resolver.
  const getSession: SessionResolver =
    resolveSession ?? (async () => (await import("@/server/auth")).auth());
  const session = await getSession();
  const user = session?.user;
  if (user === undefined || typeof user.id !== "string") {
    throw authRequired();
  }

  const principal: AdminPrincipal = {
    actor: { id: user.id, role: user.role },
    mustChangePassword: user.mustChangePassword,
    sessionVersion: user.sessionVersion,
  };

  if (
    options.allowForcedPasswordChange !== true &&
    principal.mustChangePassword
  ) {
    throw new AppError({
      status: 403,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before continuing.",
    });
  }

  if (options.capability !== undefined) {
    requireCapability(principal.actor, options.capability);
  }

  return principal;
}
