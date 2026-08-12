import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";

/**
 * Role-based capability model for administrator authorization.
 *
 * This module is pure policy: it has no database, React, Next.js, Auth.js,
 * provider, or environment access. Authorization decisions are expressed as
 * named capabilities rather than scattered direct role comparisons, so every
 * call site asks "may this actor do X?" through {@link hasCapability} /
 * {@link requireCapability} instead of re-encoding the role matrix.
 */

/** The authenticated administrator making a request. */
export interface AuthenticatedActor {
  readonly id: string;
  readonly role: AdminRole;
}

/**
 * The closed set of capabilities. Adding a new capability is a deliberate,
 * type-checked change: every role's grants below must account for it.
 */
export type Capability =
  | "admin:manage"
  | "settings:update"
  | "audit:read"
  | "content:manage"
  | "inquiry:manage"
  | "media:manage";

/**
 * The complete role-to-capability matrix.
 *
 * OWNER holds every capability. MANAGER is scoped to day-to-day content,
 * inquiry, and media work and is explicitly denied `admin:manage`,
 * `settings:update`, and `audit:read`. Both roles are listed exhaustively; the
 * record and its arrays are frozen so the matrix cannot be mutated at runtime.
 */
export const ROLE_CAPABILITIES: Readonly<
  Record<AdminRole, readonly Capability[]>
> = Object.freeze({
  [AdminRole.owner]: Object.freeze([
    "admin:manage",
    "settings:update",
    "audit:read",
    "content:manage",
    "inquiry:manage",
    "media:manage",
  ]) as readonly Capability[],
  [AdminRole.manager]: Object.freeze([
    "content:manage",
    "inquiry:manage",
    "media:manage",
  ]) as readonly Capability[],
});

/** Whether the actor's role grants the given capability. */
export function hasCapability(
  actor: AuthenticatedActor,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[actor.role].includes(capability);
}

/**
 * Assert that the actor holds the capability, throwing a stable, generic 403
 * {@link AppError} otherwise. The message never names the capability or role,
 * so authorization structure is not disclosed to callers.
 */
export function requireCapability(
  actor: AuthenticatedActor,
  capability: Capability,
): void {
  if (!hasCapability(actor, capability)) {
    throw new AppError({
      status: 403,
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action.",
    });
  }
}
