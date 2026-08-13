import { describe, expect, it, vi } from "vitest";

// next-auth's package root pulls in `next/server`, which cannot resolve under
// Vitest. Mirror the mock used by the login-action tests so the real error
// classes (which extend these) keep their instanceof relationships.
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return { AuthError, CredentialsSignin };
});

import { AuthError, CredentialsSignin } from "next-auth";

import {
  AUTHENTICATION_INTERNAL_CODE,
  AUTHENTICATION_UNAVAILABLE_CODE,
  AuthenticationInternalFailure,
  AuthenticationUnavailable,
  RateLimitedSignin,
} from "@/server/auth/errors";

/**
 * These classes are the complete set of results the Credentials `authorize`
 * callback can throw. @auth/core rethrows any thrown `AuthError` as-is but only
 * surfaces a `CredentialsSignin` (the "invalid credentials" family) when
 * authorize returns null or throws a `CredentialsSignin`. So the hierarchy below
 * is what keeps rate-limiter/configuration/internal faults from being reported
 * to the client as invalid credentials.
 */

describe("RateLimitedSignin", () => {
  it("stays in the CredentialsSignin family with a distinct, safe code", () => {
    const error = new RateLimitedSignin();
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe("rate_limited");
  });
});

describe("AuthenticationUnavailable", () => {
  it("is an AuthError but never a CredentialsSignin", () => {
    const error = new AuthenticationUnavailable();
    expect(error).toBeInstanceOf(AuthError);
    expect(error).not.toBeInstanceOf(CredentialsSignin);
    expect(error.code).toBe(AUTHENTICATION_UNAVAILABLE_CODE);
  });

  it("carries no sensitive context in its message", () => {
    const { message } = new AuthenticationUnavailable();
    expect(message).not.toMatch(/password|hash|secret|token|@/iu);
  });
});

describe("AuthenticationInternalFailure", () => {
  it("is an AuthError but never a CredentialsSignin", () => {
    const error = new AuthenticationInternalFailure();
    expect(error).toBeInstanceOf(AuthError);
    expect(error).not.toBeInstanceOf(CredentialsSignin);
    expect(error.code).toBe(AUTHENTICATION_INTERNAL_CODE);
  });

  it("carries no sensitive context in its message", () => {
    const { message } = new AuthenticationInternalFailure();
    expect(message).not.toMatch(/password|hash|secret|token|@/iu);
  });
});
