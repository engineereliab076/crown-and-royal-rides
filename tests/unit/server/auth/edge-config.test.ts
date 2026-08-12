import { describe, expect, it } from "vitest";

import { evaluateAdminAccess } from "@/server/auth/edge-config";

describe("evaluateAdminAccess", () => {
  it("always allows the Auth.js endpoints (even anonymously)", () => {
    expect(
      evaluateAdminAccess({
        pathname: "/api/admin/auth/callback/credentials",
        isLoggedIn: false,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluateAdminAccess({
        pathname: "/api/admin/auth/session",
        isLoggedIn: false,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("always allows the login page anonymously (no redirect loop)", () => {
    expect(
      evaluateAdminAccess({ pathname: "/admin/login", isLoggedIn: false }),
    ).toEqual({ kind: "allow" });
  });

  it("redirects anonymous admin page requests to login", () => {
    expect(
      evaluateAdminAccess({ pathname: "/admin", isLoggedIn: false }),
    ).toEqual({ kind: "redirect-login" });
    expect(
      evaluateAdminAccess({
        pathname: "/admin/change-password",
        isLoggedIn: false,
      }),
    ).toEqual({ kind: "redirect-login" });
  });

  it("returns unauthorized for anonymous admin API requests", () => {
    expect(
      evaluateAdminAccess({ pathname: "/api/admin/brands", isLoggedIn: false }),
    ).toEqual({ kind: "unauthorized" });
  });

  it("allows any admin route once a valid token is present", () => {
    expect(
      evaluateAdminAccess({ pathname: "/admin", isLoggedIn: true }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluateAdminAccess({ pathname: "/api/admin/brands", isLoggedIn: true }),
    ).toEqual({ kind: "allow" });
  });
});
