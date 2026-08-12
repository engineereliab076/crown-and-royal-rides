import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { decideAdminPageAccess } from "@/server/auth/page-guard";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function user(
  role: AdminRole,
  mustChangePassword = false,
): NonNullable<Session["user"]> {
  return {
    id: ID,
    name: "Test Administrator",
    role,
    mustChangePassword,
    sessionVersion: 1,
  };
}

describe("admin page access decisions", () => {
  it("redirects anonymous visitors to login", () => {
    expect(decideAdminPageAccess(undefined)).toEqual({
      allowed: false,
      redirectTo: "/admin/login",
    });
  });

  it("redirects forced-change administrators before capability checks", () => {
    expect(
      decideAdminPageAccess(user(AdminRole.owner, true), "admin:manage"),
    ).toEqual({
      allowed: false,
      redirectTo: "/admin/change-password",
    });
  });

  it.each(["admin:manage", "settings:update", "audit:read"] as const)(
    "server-side refuses a manager for %s",
    (capability) => {
      expect(
        decideAdminPageAccess(user(AdminRole.manager), capability),
      ).toEqual({
        allowed: false,
        redirectTo: "/admin?status=forbidden",
      });
    },
  );

  it("allows an owner through protected pages", () => {
    expect(
      decideAdminPageAccess(user(AdminRole.owner), "admin:manage").allowed,
    ).toBe(true);
  });
});
