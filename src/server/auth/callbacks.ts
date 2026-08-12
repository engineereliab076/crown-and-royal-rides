import "server-only";

import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

import type { AuthService } from "@/server/modules/auth/service";

/**
 * Pure Auth.js callback logic, extracted so it can be unit-tested without the
 * Auth.js HTTP runtime. Only non-sensitive identity fields ever enter the token
 * or session; `passwordHash` and active status never do.
 */

/**
 * Copy safe administrator fields into the JWT on initial sign-in. This runs
 * only when `user` is present (the sign-in event); on later invocations the
 * token is returned unchanged so no database query happens per request.
 */
export function applyUserToToken(token: JWT, user: User): JWT {
  if (typeof user.id === "string") token.sub = user.id;
  token.role = user.role;
  token.sessionVersion = user.sessionVersion;
  token.mustChangePassword = user.mustChangePassword;
  return token;
}

/**
 * Build the session by validating the token against the database with exactly
 * one indexed lookup. On any validation failure the returned session exposes no
 * authenticated `user`, so callers treat it as unauthenticated. On success the
 * role and forced-change flag come from the database, not the token.
 */
export async function buildValidatedSession(
  session: Session,
  token: JWT,
  authService: Pick<AuthService, "validateSession">,
): Promise<Session> {
  const validated = await authService.validateSession({
    id: token.sub,
    sessionVersion: token.sessionVersion,
  });

  if (validated === null) {
    return { ...session, user: undefined };
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: validated.id,
      name: validated.name,
      role: validated.role,
      sessionVersion: validated.sessionVersion,
      mustChangePassword: validated.mustChangePassword,
    },
  };
}
