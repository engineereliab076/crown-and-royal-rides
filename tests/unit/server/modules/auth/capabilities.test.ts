import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  type AuthenticatedActor,
  type Capability,
  hasCapability,
  requireCapability,
  ROLE_CAPABILITIES,
} from "@/server/modules/auth/capabilities";
import { AppError, isAppError } from "@/server/http/errors";

const ALL_CAPABILITIES: readonly Capability[] = [
  "admin:manage",
  "settings:update",
  "audit:read",
  "content:manage",
  "inquiry:manage",
  "media:manage",
];

const OWNER_ONLY: readonly Capability[] = [
  "admin:manage",
  "settings:update",
  "audit:read",
];

const SHARED: readonly Capability[] = [
  "content:manage",
  "inquiry:manage",
  "media:manage",
];

function actor(role: AdminRole): AuthenticatedActor {
  return { id: "00000000-0000-0000-0000-000000000000", role };
}

describe("ROLE_CAPABILITIES matrix", () => {
  it("grants the owner every capability", () => {
    expect([...ROLE_CAPABILITIES[AdminRole.owner]].sort()).toEqual(
      [...ALL_CAPABILITIES].sort(),
    );
  });

  it("grants the manager only the shared capabilities", () => {
    expect([...ROLE_CAPABILITIES[AdminRole.manager]].sort()).toEqual(
      [...SHARED].sort(),
    );
  });

  it("covers every AdminRole exactly", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual(
      Object.values(AdminRole).sort(),
    );
  });

  it("is immutable at runtime", () => {
    expect(Object.isFrozen(ROLE_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(ROLE_CAPABILITIES[AdminRole.owner])).toBe(true);
    expect(Object.isFrozen(ROLE_CAPABILITIES[AdminRole.manager])).toBe(true);
  });

  it("never grants the manager owner-only capabilities", () => {
    for (const capability of OWNER_ONLY) {
      expect(hasCapability(actor(AdminRole.manager), capability)).toBe(false);
    }
  });
});

describe("hasCapability", () => {
  it.each(ALL_CAPABILITIES)("owner may %s", (capability) => {
    expect(hasCapability(actor(AdminRole.owner), capability)).toBe(true);
  });

  it.each(SHARED)("manager may %s", (capability) => {
    expect(hasCapability(actor(AdminRole.manager), capability)).toBe(true);
  });

  it.each(OWNER_ONLY)("manager may not %s", (capability) => {
    expect(hasCapability(actor(AdminRole.manager), capability)).toBe(false);
  });
});

describe("requireCapability", () => {
  it("passes silently when the capability is granted", () => {
    expect(() =>
      requireCapability(actor(AdminRole.manager), "content:manage"),
    ).not.toThrow();
    expect(() =>
      requireCapability(actor(AdminRole.owner), "admin:manage"),
    ).not.toThrow();
  });

  it.each(OWNER_ONLY)(
    "throws a stable generic 403 when the manager lacks %s",
    (capability) => {
      let caught: unknown;
      try {
        requireCapability(actor(AdminRole.manager), capability);
      } catch (error) {
        caught = error;
      }

      expect(isAppError(caught)).toBe(true);
      const appError = caught as AppError;
      expect(appError.status).toBe(403);
      expect(appError.code).toBe("FORBIDDEN");
      expect(appError.message).toBe(
        "You do not have permission to perform this action.",
      );
      // The generic message must not disclose the capability or role.
      expect(appError.message).not.toContain(capability);
      expect(appError.message).not.toContain(AdminRole.manager);
    },
  );
});
