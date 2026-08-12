import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  applyUserToToken,
  buildValidatedSession,
} from "@/server/auth/callbacks";
import type { CredentialAdmin } from "@/server/modules/auth/repository";
import { createAuthService } from "@/server/modules/auth/service";

import { FakeAuthRepository } from "../modules/auth/support/fake-auth-repository";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function record(overrides: Partial<CredentialAdmin> = {}): CredentialAdmin {
  return {
    id: OWNER_ID,
    email: "owner@example.com",
    name: "Test Owner",
    passwordHash: "$argon2id$v=19$m=65536,p=4,t=3$aaaa$bbbb",
    role: AdminRole.owner,
    isActive: true,
    sessionVersion: 1,
    mustChangePassword: false,
    ...overrides,
  };
}

function baseSession(): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function baseToken(overrides: Partial<JWT> = {}): JWT {
  return {
    sub: OWNER_ID,
    role: AdminRole.owner,
    sessionVersion: 1,
    mustChangePassword: false,
    ...overrides,
  } as JWT;
}

describe("applyUserToToken", () => {
  it("copies only safe identity fields into the token", () => {
    const user: User = {
      id: OWNER_ID,
      email: "owner@example.com",
      role: AdminRole.manager,
      sessionVersion: 7,
      mustChangePassword: true,
    };
    const token = applyUserToToken(baseToken(), user);

    expect(token.sub).toBe(OWNER_ID);
    expect(token.role).toBe(AdminRole.manager);
    expect(token.sessionVersion).toBe(7);
    expect(token.mustChangePassword).toBe(true);
    expect(token).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(token)).not.toContain("passwordHash");
  });
});

describe("buildValidatedSession", () => {
  it("performs exactly one indexed lookup and populates the session", async () => {
    const repository = new FakeAuthRepository([record()]);
    const authService = createAuthService({ repository });

    const session = await buildValidatedSession(
      baseSession(),
      baseToken(),
      authService,
    );

    expect(repository.sessionLookups).toBe(1);
    expect(session.user?.id).toBe(OWNER_ID);
    expect(session.user?.name).toBe("Test Owner");
  });

  it("uses the current database role and forced-change flag, not the token", async () => {
    const repository = new FakeAuthRepository([
      record({ role: AdminRole.manager, mustChangePassword: true }),
    ]);
    const authService = createAuthService({ repository });

    // Token still claims OWNER / not-forced; the database is authoritative.
    const session = await buildValidatedSession(
      baseSession(),
      baseToken({ role: AdminRole.owner, mustChangePassword: false }),
      authService,
    );

    expect(session.user?.role).toBe(AdminRole.manager);
    expect(session.user?.mustChangePassword).toBe(true);
  });

  it("never exposes a password hash in the session", async () => {
    const repository = new FakeAuthRepository([record()]);
    const authService = createAuthService({ repository });

    const session = await buildValidatedSession(
      baseSession(),
      baseToken(),
      authService,
    );

    expect(session.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(session)).not.toContain("passwordHash");
    expect(JSON.stringify(session)).not.toContain("argon2");
  });

  it("clears the user when the administrator is missing", async () => {
    const repository = new FakeAuthRepository([]);
    const authService = createAuthService({ repository });

    const session = await buildValidatedSession(
      baseSession(),
      baseToken(),
      authService,
    );

    expect(session.user).toBeUndefined();
  });

  it("clears the user when the administrator is inactive", async () => {
    const repository = new FakeAuthRepository([record({ isActive: false })]);
    const authService = createAuthService({ repository });

    const session = await buildValidatedSession(
      baseSession(),
      baseToken(),
      authService,
    );

    expect(session.user).toBeUndefined();
  });

  it("clears the user when the session version does not match", async () => {
    const repository = new FakeAuthRepository([record({ sessionVersion: 2 })]);
    const authService = createAuthService({ repository });

    const session = await buildValidatedSession(
      baseSession(),
      baseToken({ sessionVersion: 1 }),
      authService,
    );

    expect(session.user).toBeUndefined();
  });
});
