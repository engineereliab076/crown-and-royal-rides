import "server-only";

import type { Session } from "next-auth";
import { redirect } from "next/navigation";

import { getValidatedAdminSession } from "@/server/auth/session";
import {
  hasCapability,
  type Capability,
} from "@/server/modules/auth/capabilities";

export type AdminPageUser = NonNullable<Session["user"]>;

export type PageAccessDecision =
  | { readonly allowed: true; readonly user: AdminPageUser }
  | { readonly allowed: false; readonly redirectTo: string };

export function decideAdminPageAccess(
  user: AdminPageUser | undefined,
  capability?: Capability,
): PageAccessDecision {
  if (user === undefined) {
    return { allowed: false, redirectTo: "/admin/login" };
  }
  if (user.mustChangePassword) {
    return { allowed: false, redirectTo: "/admin/change-password" };
  }
  if (
    capability !== undefined &&
    !hasCapability({ id: user.id, role: user.role }, capability)
  ) {
    return { allowed: false, redirectTo: "/admin?status=forbidden" };
  }
  return { allowed: true, user };
}

export async function requireAdminPage(
  capability?: Capability,
  resolveSession: () => Promise<Session | null> = getValidatedAdminSession,
): Promise<AdminPageUser> {
  const session = await resolveSession();
  const decision = decideAdminPageAccess(session?.user, capability);
  if (!decision.allowed) redirect(decision.redirectTo);
  return decision.user;
}
