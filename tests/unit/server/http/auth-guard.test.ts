import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/http/auth-guard";
import { AppError, isAppError } from "@/server/http/errors";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function sessionFor(
  overrides: Partial<NonNullable<Session["user"]>> = {},
): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: OWNER_ID,
      role: AdminRole.owner,
      sessionVersion: 1,
      mustChangePassword: false,
      ...overrides,
    },
  } as Session;
}

function resolver(session: Session | null) {
  return async () => session;
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected requireAdmin to reject");
}

describe("requireAdmin", () => {
  it("returns the principal for a valid admin session", async () => {
    const principal = await requireAdmin({}, resolver(sessionFor()));
    expect(principal.actor).toEqual({ id: OWNER_ID, role: AdminRole.owner });
    expect(principal.mustChangePassword).toBe(false);
    expect(principal.sessionVersion).toBe(1);
  });

  it("throws 401 when there is no session", async () => {
    const error = await capture(requireAdmin({}, resolver(null)));
    expect(isAppError(error)).toBe(true);
    expect((error as AppError).status).toBe(401);
    expect((error as AppError).code).toBe("AUTH_REQUIRED");
  });

  it("throws 401 when the session has no authenticated user", async () => {
    const invalid = {
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session;
    const error = await capture(requireAdmin({}, resolver(invalid)));
    expect((error as AppError).status).toBe(401);
  });

  it("throws 403 for a forced-change admin by default", async () => {
    const error = await capture(
      requireAdmin({}, resolver(sessionFor({ mustChangePassword: true }))),
    );
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("allows a forced-change admin when explicitly permitted", async () => {
    const principal = await requireAdmin(
      { allowForcedPasswordChange: true },
      resolver(sessionFor({ mustChangePassword: true })),
    );
    expect(principal.mustChangePassword).toBe(true);
  });

  it("enforces a required capability (owner allowed)", async () => {
    await expect(
      requireAdmin({ capability: "admin:manage" }, resolver(sessionFor())),
    ).resolves.toBeDefined();
  });

  it("throws 403 when the actor lacks the required capability", async () => {
    const error = await capture(
      requireAdmin(
        { capability: "admin:manage" },
        resolver(sessionFor({ role: AdminRole.manager })),
      ),
    );
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).code).toBe("FORBIDDEN");
  });
});
