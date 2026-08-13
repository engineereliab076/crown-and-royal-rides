import { describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { performLogin, type LoginDependencies } from "@/server/auth/login";
import { AppError } from "@/server/http/errors";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type { RateLimitDecision } from "@/server/modules/auth/rate-limit";
import { createAuthRateLimiter } from "@/server/modules/auth/rate-limit";
import type { CredentialAdmin } from "@/server/modules/auth/repository";
import type { AuthenticatedAdmin } from "@/server/modules/auth/service";
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

const AUTHENTICATED_ADMIN: AuthenticatedAdmin = {
  id: OWNER_ID,
  email: EMAIL,
  name: "Test Owner",
  role: AdminRole.owner,
  sessionVersion: 1,
  mustChangePassword: false,
};

/**
 * A deps builder with fully controllable stubs, used to exercise the safe
 * classification paths (unexpected verification errors, best-effort bookkeeping)
 * without depending on the real Argon2 verifier or limiter internals.
 */
function stubDeps(overrides: {
  verifyCredentials?: LoginDependencies["authService"]["verifyCredentials"];
  recordLogin?: LoginDependencies["authService"]["recordLogin"];
  checkLoginIp?: LoginDependencies["authRateLimiter"]["checkLoginIp"];
  recordLoginFailure?: LoginDependencies["authRateLimiter"]["recordLoginFailure"];
  reportFailure?: LoginDependencies["reportFailure"];
}): LoginDependencies {
  const allowed: RateLimitDecision = { allowed: true };
  return {
    authService: {
      verifyCredentials:
        overrides.verifyCredentials ?? (async () => AUTHENTICATED_ADMIN),
      recordLogin: overrides.recordLogin ?? vi.fn(async () => {}),
    },
    authRateLimiter: {
      checkLoginIp: overrides.checkLoginIp ?? (async () => allowed),
      recordLoginFailure: overrides.recordLoginFailure ?? (async () => allowed),
    },
    reportFailure: overrides.reportFailure,
  };
}

function invalidCredentials(): AppError {
  return new AppError({
    status: 401,
    code: "AUTH_INVALID_CREDENTIALS",
    message: "Invalid email or password.",
  });
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
        checkLoginIp: async () => ({ allowed: false, reason: "limited" }),
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

  it("fails closed as rate_limiter_unavailable when the limiter provider throws", async () => {
    const providerMarker = "RAW_RATE_LIMIT_PROVIDER_FAILURE";
    const throwingLimiter: RateLimiter = {
      async check() {
        throw new Error(providerMarker);
      },
    };
    const verifyCredentials = vi.fn();
    const reportFailure = vi.fn();
    const deps: LoginDependencies = {
      authService: {
        verifyCredentials,
        recordLogin: vi.fn(async () => {}),
      },
      authRateLimiter: createAuthRateLimiter({
        rateLimiter: throwingLimiter,
        hashSecret: HASH_SECRET,
      }),
      reportFailure,
    };

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "1.2.3.4" },
      deps,
    );

    // Fail-closed still denies the attempt, but as an unavailable-limiter
    // classification — never as invalid credentials — so authorize maps it to a
    // non-CredentialsSignin AuthenticationUnavailable rather than a generic
    // CredentialsSignin.
    expect(outcome).toEqual({ status: "rate_limiter_unavailable" });
    expect(verifyCredentials).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith("rate_limiter_unavailable");
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(providerMarker);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("1.2.3.4");
  });
});

describe("performLogin — best-effort post-auth bookkeeping", () => {
  it("still succeeds when recordLogin fails, and reports it as bookkeeping", async () => {
    const reportFailure = vi.fn();
    const deps = stubDeps({
      recordLogin: async () => {
        throw new Error("timestamp write failed");
      },
      reportFailure,
    });

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toMatchObject({ status: "ok" });
    if (outcome.status === "ok") expect(outcome.admin.id).toBe(OWNER_ID);
    expect(reportFailure).toHaveBeenCalledWith("post_auth_bookkeeping");
  });

  it("still succeeds when the safe post-auth reporter itself throws", async () => {
    const deps = stubDeps({
      recordLogin: async () => {
        throw new Error("timestamp write failed");
      },
      reportFailure: () => {
        // A broken diagnostics sink must never change the auth outcome.
        throw new Error("reporter is down");
      },
    });

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toMatchObject({ status: "ok" });
  });

  it("succeeds without touching the reporter when bookkeeping succeeds", async () => {
    const reportFailure = vi.fn();
    const deps = stubDeps({ reportFailure });

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toMatchObject({ status: "ok" });
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe("performLogin — safe failure classification", () => {
  it("keeps genuine wrong credentials as a generic invalid result", async () => {
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw invalidCredentials();
      },
      reportFailure,
    });

    const outcome = await performLogin(
      { email: EMAIL, password: "wrong-password", ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toEqual({ status: "invalid" });
    // A genuine credential rejection is not an internal/provider fault.
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("maps a genuine email lockout to rate_limited, not unavailable", async () => {
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw invalidCredentials();
      },
      recordLoginFailure: async () => ({ allowed: false, reason: "limited" }),
      reportFailure,
    });

    const outcome = await performLogin(
      { email: EMAIL, password: "wrong-password", ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toEqual({ status: "rate_limited" });
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("maps an unavailable email limiter to rate_limiter_unavailable", async () => {
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw invalidCredentials();
      },
      recordLoginFailure: async () => ({
        allowed: false,
        reason: "unavailable",
      }),
      reportFailure,
    });

    const outcome = await performLogin(
      { email: EMAIL, password: "wrong-password", ip: "203.0.113.7" },
      deps,
    );

    expect(outcome).toEqual({ status: "rate_limiter_unavailable" });
    expect(reportFailure).toHaveBeenCalledWith("rate_limiter_unavailable");
  });

  it("maps an unavailable IP limiter decision to rate_limiter_unavailable", async () => {
    const verifyCredentials = vi.fn();
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials,
      checkLoginIp: async () => ({ allowed: false, reason: "unavailable" }),
      reportFailure,
    });

    const outcome = await performLogin(
      { email: EMAIL, password: PASSWORD, ip: "1.2.3.4" },
      deps,
    );

    expect(outcome).toEqual({ status: "rate_limiter_unavailable" });
    expect(verifyCredentials).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith("rate_limiter_unavailable");
  });

  it("rethrows an unexpected verification error instead of labeling it invalid", async () => {
    const boom = new Error("prisma connection reset");
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw boom;
      },
      recordLoginFailure: vi.fn(),
      reportFailure,
    });

    await expect(
      performLogin({ email: EMAIL, password: PASSWORD, ip: "1.2.3.4" }, deps),
    ).rejects.toBe(boom);
    expect(reportFailure).toHaveBeenCalledWith("unexpected_internal");
    // An unexpected fault must never spend the email failure allowance.
    expect(deps.authRateLimiter.recordLoginFailure).not.toHaveBeenCalled();
  });

  it("treats a non-credential AppError as unexpected and rethrows it", async () => {
    const other = new AppError({
      status: 500,
      code: "DATABASE_UNAVAILABLE",
      message: "The database is unavailable.",
    });
    const reportFailure = vi.fn();
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw other;
      },
      reportFailure,
    });

    await expect(
      performLogin({ email: EMAIL, password: PASSWORD, ip: "1.2.3.4" }, deps),
    ).rejects.toBe(other);
    expect(reportFailure).toHaveBeenCalledWith("unexpected_internal");
  });

  it("does not let a throwing reporter mask the rethrown internal error", async () => {
    const boom = new Error("prisma connection reset");
    const deps = stubDeps({
      verifyCredentials: async () => {
        throw boom;
      },
      reportFailure: () => {
        throw new Error("reporter is down");
      },
    });

    await expect(
      performLogin({ email: EMAIL, password: PASSWORD, ip: "1.2.3.4" }, deps),
    ).rejects.toBe(boom);
  });
});
