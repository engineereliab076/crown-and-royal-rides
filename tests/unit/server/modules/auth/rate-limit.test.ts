import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import {
  createAuthRateLimiter,
  LOGIN_EMAIL_POLICY,
  LOGIN_IP_POLICY,
  PASSWORD_CHANGE_POLICY,
} from "@/server/modules/auth/rate-limit";

const HASH_SECRET = "unit-test-hash-secret-abcdefghijklmnop";

function fixedLimiter(): InMemoryRateLimiter {
  // Freeze the clock so every check falls in the same fixed window.
  return new InMemoryRateLimiter(() => 1_000_000);
}

function authRateLimiter(rateLimiter: RateLimiter) {
  return createAuthRateLimiter({ rateLimiter, hashSecret: HASH_SECRET });
}

describe("recordLoginFailure — email failure counting", () => {
  it("allows four failures, reaches the boundary on the fifth, locks the sixth", async () => {
    const backingLimiter = fixedLimiter();
    const limiter = authRateLimiter(backingLimiter);
    const fail = () => limiter.recordLoginFailure("owner@example.com");

    // Failures 1–4 remain allowed.
    for (let i = 0; i < LOGIN_EMAIL_POLICY.limit - 1; i += 1) {
      expect((await fail()).allowed).toBe(true);
    }
    expect(backingLimiter.getState()).toMatchObject([{ count: 4 }]);

    // The fifth failure reaches the lockout boundary (window allowance is now
    // fully consumed) but is itself still recorded as allowed.
    expect((await fail()).allowed).toBe(true);
    expect(backingLimiter.getState()).toMatchObject([{ count: 5 }]);

    // The sixth failed attempt is locked out.
    expect((await fail()).allowed).toBe(false);
    expect(backingLimiter.getState()).toMatchObject([{ count: 5 }]);
  });

  it("shares one counter across email casing/whitespace differences", async () => {
    const backingLimiter = fixedLimiter();
    const limiter = authRateLimiter(backingLimiter);

    const variants = [
      "owner@example.com",
      "OWNER@example.com",
      "Owner@Example.Com",
      " owner@example.com ",
      "  OWNER@Example.COM ",
    ];
    for (const email of variants) {
      expect((await limiter.recordLoginFailure(email)).allowed).toBe(true);
    }

    expect(backingLimiter.getState()).toHaveLength(1);
    expect(backingLimiter.getState()[0]?.count).toBe(LOGIN_EMAIL_POLICY.limit);
    expect(
      (await limiter.recordLoginFailure("owner@example.com")).allowed,
    ).toBe(false);
  });
});

describe("checkLoginIp — per-IP attempt counting", () => {
  it("counts every attempt and locks out after the IP limit", async () => {
    const limiter = authRateLimiter(fixedLimiter());

    for (let i = 0; i < LOGIN_IP_POLICY.limit; i += 1) {
      expect((await limiter.checkLoginIp("203.0.113.7")).allowed).toBe(true);
    }
    expect((await limiter.checkLoginIp("203.0.113.7")).allowed).toBe(false);
  });

  it("allows through when the client IP is unknown", async () => {
    const limiter = authRateLimiter(fixedLimiter());
    expect((await limiter.checkLoginIp(null)).allowed).toBe(true);
    expect((await limiter.checkLoginIp("")).allowed).toBe(true);
  });
});

describe("checkPasswordChange — per-administrator counting", () => {
  it("locks out after the configured attempts", async () => {
    const limiter = authRateLimiter(fixedLimiter());
    const adminId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

    for (let i = 0; i < PASSWORD_CHANGE_POLICY.limit; i += 1) {
      expect((await limiter.checkPasswordChange({ adminId })).allowed).toBe(
        true,
      );
    }
    expect((await limiter.checkPasswordChange({ adminId })).allowed).toBe(
      false,
    );
  });
});

describe("fail-closed on provider failure", () => {
  const throwingLimiter: RateLimiter = {
    async check() {
      throw new Error("rate-limit backend unavailable");
    },
  };

  it("denies the IP gate when the limiter throws", async () => {
    const limiter = authRateLimiter(throwingLimiter);
    expect((await limiter.checkLoginIp("1.2.3.4")).allowed).toBe(false);
  });

  it("denies email failure recording when the limiter throws", async () => {
    const limiter = authRateLimiter(throwingLimiter);
    expect((await limiter.recordLoginFailure("a@b.com")).allowed).toBe(false);
  });

  it("denies password change when the limiter throws", async () => {
    const limiter = authRateLimiter(throwingLimiter);
    expect((await limiter.checkPasswordChange({ adminId: "x" })).allowed).toBe(
      false,
    );
  });
});

describe("key hashing", () => {
  it("never stores the raw email or IP in the limiter key", async () => {
    const limiter = fixedLimiter();
    const auth = authRateLimiter(limiter);

    const email = "secret.person@example.com";
    const ip = "198.51.100.42";
    await auth.checkLoginIp(ip);
    await auth.recordLoginFailure(email);

    const keys = limiter.getState().map((entry) => entry.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain(email);
      expect(key).not.toContain(email.toLowerCase());
      expect(key).not.toContain("secret.person");
      expect(key).not.toContain(ip);
      expect(key).toMatch(/^auth:login:(?:email|ip):[A-Za-z0-9_-]{43}$/u);
    }
    expect(keys.some((key) => key.startsWith("auth:login:email:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("auth:login:ip:"))).toBe(true);
  });

  it("requires a non-empty hash secret", () => {
    expect(() =>
      createAuthRateLimiter({ rateLimiter: fixedLimiter(), hashSecret: "" }),
    ).toThrow(TypeError);
  });
});
