import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import {
  hasCapability,
  type Capability,
} from "@/server/modules/auth/capabilities";

export type AdminNavigationIcon =
  "dashboard" | "vehicles" | "inquiries" | "users" | "audit" | "settings";

export interface AdminNavigationItem {
  readonly label: string;
  readonly href: string;
  readonly icon: AdminNavigationIcon;
  readonly capability?: Capability;
}

/** The single navigation source used by desktop and mobile shell variants. */
export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = Object.freeze([
  { label: "Dashboard", href: "/admin", icon: "dashboard" },
  {
    label: "Vehicles",
    href: "/admin/vehicles",
    icon: "vehicles",
    capability: "content:manage",
  },
  {
    label: "Inquiries",
    href: "/admin/inquiries",
    icon: "inquiries",
    capability: "inquiry:manage",
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: "users",
    capability: "admin:manage",
  },
  {
    label: "Audit Log",
    href: "/admin/audit-log",
    icon: "audit",
    capability: "audit:read",
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: "settings",
    capability: "settings:update",
  },
] as const);

export function getAdminNavigation(
  actor: AuthenticatedActor,
): readonly AdminNavigationItem[] {
  return ADMIN_NAVIGATION.filter(
    (item) =>
      item.capability === undefined || hasCapability(actor, item.capability),
  );
}
