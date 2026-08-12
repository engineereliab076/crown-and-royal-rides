import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { performLogin, type LoginDependencies } from "@/server/auth/login";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import { createAuthRateLimiter } from "@/server/modules/auth/rate-limit";
import type { CredentialAdmin } from "@/server/modules/auth/repository";
import { createAuthService } from "@/server/modules/auth/service";

import { FakeAuthRepository } from "../modules/auth/support/fake-auth-repository";

const HASH_SECRET = "unit-test-hash-secret-abcdefghijklmnop";
const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EMAIL = "owner@example.com";
const PASSWORD = "owner-password-123";

// These tests exercise rate-limit *counting order*, not Argon2 itself (covered
// in password/service tests), so a fast deterministic verifier is injected.
const fakeVerify = async (_hash: string, password: string) =>
  password === PASSWORD;

function record(overrides: Partial<CredentialAdmin> = {}): CredentialAdmin {
  return {
    id: OWNER_ID,
    email: EMAIL,
    name: "Test Owner",
    passwordHash: "$argon2id$v=19$m=65536,p=4,t=3$c3R1Yg$c3R1Yg",
    role: AdminRole.owner,
    isActive: true,
    sessionVersion: 1,
    mustChangePassword: false,
    ...overrides,
  };
}

function harness() {
  const repository = new FakeAuthRepository([record()]);
  const authService = createAuthService({
    repository,
    verifyPassword: fakeVerify,
  });
  const limiter = new InMemoryRateLimiter(() => 1_000_000);
  const authRateLimiter = createAuthRateLimiter({
    rateLimiter: limiter,
    hashSecret: HASH_SECRET,
  });
  return { repository, authService, limiter, authRateLimiter };
}

function emailKeys(limiter: InMemoryRateLimiter) {
  return limiter
    .getState()
    .filter((e) => e.key.startsWith("auth:login:email:"));
}

function ipKeys(limiter: InMemoryRateLimiter) {
  return limiter.getState().filter((e) => e.key.startsWith("auth:login:ip:"));
}

describe("performLogin — success path", () => {
  it("succeeds and never consumes the email failure counter", async () => {
    const h = await harness();
    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: null },
      h,
    );

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.admin.id).toBe(OWNER_ID);
    // The email failure counter was never touched by a success.
    expect(emailKeys(h.limiter)).toHaveLength(0);
    expect(h.repository.loginRecords).toBe(1);
  });

  it("does not consume an existing email failure allowance on success", async () => {
    const h = await harness();
    for (let i = 0; i < 4; i += 1) {
      expect(
        (
          await performLogin(
            { email: EMAIL, password: "wrong-password", ip: null },
            h,
          )
        ).status,
      ).toBe("invalid");
    }
    expect(emailKeys(h.limiter)[0]?.count).toBe(4);

    await expect(
      performLogin({ email: EMAIL, password: PASSWORD, ip: null }, h),
    ).resolves.toMatchObject({ status: "ok" });
    expect(emailKeys(h.limiter)[0]?.count).toBe(4);
  });

  it("does not lock the account across many repeated successful logins", async () => {
    const h = await harness();
    for (let i = 0; i < 10; i += 1) {
      const outcome = await performLogin(
        { email: EMAIL, password: PASSWORD, ip: null },
        h,
      );
      expect(outcome.status).toBe("ok");
    }
    expect(emailKeys(h.limiter)).toHaveLength(0);
  });

  it("counts the per-IP attempt before verification, even on success", async () => {
    const h = await harness();
    await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.7" },
      h,
    );

    const ip = ipKeys(h.limiter);
    expect(ip).toHaveLength(1);
    expect(ip[0]?.count).toBe(1);
  });

  it("invokes the IP limiter before credential verification", async () => {
    const callOrder: string[] = [];
    const deps: LoginDependencies = {
      authService: {
        async verifyCredentials() {
          callOrder.push("verify");
          return {
            id: OWNER_ID,
            email: EMAIL,
            name: "Test Owner",
            role: AdminRole.owner,
            sessionVersion: 1,
            mustChangePassword: false,
          };
        },
        recordLogin: vi.fn(async () => {}),
      },
      authRateLimiter: {
        async checkLoginIp() {
          callOrder.push("ip");
          return { allowed: true };
        },
        recordLoginFailure: vi.fn(),
      },
    };

    await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.7" },
      deps,
    );

    expect(callOrder).toEqual(["ip", "verify"]);
  });
});

describe("performLogin — failure path", () => {
  it("returns a generic invalid result for a wrong password and consumes one email failure", async () => {
    const h = await harness();
    const outcome = await performLogin(
      { email: EMAIL, password: "wrong-password", ip: null },
      h,
    );
    expect(outcome.status).toBe("invalid");
    expect(emailKeys(h.limiter)).toHaveLength(1);
    expect(emailKeys(h.limiter)[0]?.count).toBe(1);
  });

  it("locks out on the sixth failed attempt for one email", async () => {
    const h = await harness();
    for (let i = 0; i < 5; i += 1) {
      const outcome = await performLogin(
        { email: EMAIL, password: "wrong-password", ip: null },
        h,
      );
      expect(outcome.status).toBe("invalid");
    }
    const sixth = await performLogin(
      { email: EMAIL, password: "wrong-password", ip: null },
      h,
    );
    expect(sixth.status).toBe("rate_limited");
  });

  it("consumes equivalent email failure limits for unknown emails and wrong passwords", async () => {
    // Wrong password against an existing account.
    const known = await harness();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (
          await performLogin(
            { email: EMAIL, password: "wrong-password", ip: null },
            known,
          )
        ).status,
      ).toBe("invalid");
    }
    expect(
      (
        await performLogin(
          { email: EMAIL, password: "wrong-password", ip: null },
          known,
        )
      ).status,
    ).toBe("rate_limited");
    expect(emailKeys(known.limiter)[0]?.count).toBe(5);

    // Unknown email — same threshold, same generic outcomes.
    const unknown = await harness();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (
          await performLogin(
            { email: "ghost@example.com", password: "whatever", ip: null },
            unknown,
          )
        ).status,
      ).toBe("invalid");
    }
    expect(
      (
        await performLogin(
          { email: "ghost@example.com", password: "whatever", ip: null },
          unknown,
        )
      ).status,
    ).toBe("rate_limited");
    expect(emailKeys(unknown.limiter)[0]?.count).toBe(5);
  });
});

describe("performLogin — IP gate ordering and fail-closed", () => {
  it("does not verify credentials when the IP gate denies the attempt", async () => {
    const verifyCredentials = vi.fn();
    const recordLoginFailure = vi.fn();
    const deps: LoginDependencies = {
      authService: {
        verifyCredentials,
        recordLogin: vi.fn(async () => {}),
      },
      authRateLimiter: {
        checkLoginIp: async () => ({ allowed: false }),
        recordLoginFailure,
      },
    };

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "1.2.3.4" },
      deps,
    );

    expect(outcome.status).toBe("rate_limited");
    expect(verifyCredentials).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("fails closed and skips verification when the limiter provider throws", async () => {
    const providerMarker = "RAW_RATE_LIMIT_PROVIDER_FAILURE";
    const throwingLimiter: RateLimiter = {
      async check() {
        throw new Error(providerMarker);
      },
    };
    const verifyCredentials = vi.fn();
    const deps: LoginDependencies = {
      authService: {
        verifyCredentials,
        recordLogin: vi.fn(async () => {}),
      },
      authRateLimiter: createAuthRateLimiter({
        rateLimiter: throwingLimiter,
        hashSecret: HASH_SECRET,
      }),
    };

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "1.2.3.4" },
      deps,
    );

    expect(outcome).toEqual({ status: "rate_limited" });
    expect(verifyCredentials).not.toHaveBeenCalled();
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(providerMarker);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("1.2.3.4");
  });
});
