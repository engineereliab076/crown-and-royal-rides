import { AuthError, CredentialsSignin } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  signIn: mocks.signIn,
}));

vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }

  return { AuthError, CredentialsSignin };
});

vi.mock("next/navigation", () => ({
  unstable_rethrow(error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT;")
    ) {
      throw error;
    }
  },
}));

import {
  AuthenticationInternalFailure,
  AuthenticationUnavailable,
} from "@/server/auth/errors";
import { loginAction } from "@/app/admin/login/actions";

const EMAIL = "owner@example.test";
const PASSWORD = "Temporary-Password-9!";
const GENERIC_FAILURE = "Invalid email or password.";
const RATE_LIMITED =
  "Too many attempts. Please wait a few minutes and try again.";
const AUTHENTICATION_UNAVAILABLE =
  "Unable to sign in right now. Please try again shortly.";

function form(callbackUrl: string = "/admin"): FormData {
  const data = new FormData();
  data.set("email", EMAIL);
  data.set("password", PASSWORD);
  data.set("callbackUrl", callbackUrl);
  return data;
}

function redirectSignal(destination: string): Error & { digest: string } {
  return Object.assign(new Error("redirect"), {
    digest: `NEXT_REDIRECT;replace;${destination};303;`,
  });
}

beforeEach(() => {
  mocks.signIn.mockReset();
});

describe("loginAction", () => {
  it("preserves Auth.js successful sign-in redirect control flow", async () => {
    const signal = redirectSignal("/admin");
    mocks.signIn.mockRejectedValue(signal);

    await expect(loginAction({}, form())).rejects.toBe(signal);
    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: EMAIL,
      password: PASSWORD,
      redirectTo: "/admin",
    });
  });

  it("returns safe form state for invalid credentials", async () => {
    mocks.signIn.mockRejectedValue(new CredentialsSignin());

    await expect(loginAction({}, form())).resolves.toEqual({
      error: GENERIC_FAILURE,
    });
  });

  it("returns safe form state for rate-limited authentication", async () => {
    const error = new CredentialsSignin();
    error.code = "rate_limited";
    mocks.signIn.mockRejectedValue(error);

    await expect(loginAction({}, form())).resolves.toEqual({
      error: RATE_LIMITED,
    });
  });

  it("rethrows unexpected errors instead of treating them as redirects", async () => {
    const error = new Error("unexpected failure");
    mocks.signIn.mockRejectedValue(error);

    await expect(loginAction({}, form())).rejects.toBe(error);
  });

  it("fails safely if Auth.js returns without redirecting", async () => {
    mocks.signIn.mockResolvedValue(undefined);

    await expect(loginAction({}, form())).rejects.toThrow(
      "Auth.js sign-in completed without redirecting.",
    );
  });

  it("surfaces an unavailable rate limiter as a distinct, account-neutral message", async () => {
    mocks.signIn.mockRejectedValue(new AuthenticationUnavailable());

    await expect(loginAction({}, form())).resolves.toEqual({
      error: AUTHENTICATION_UNAVAILABLE,
    });
  });

  it("surfaces an unexpected internal failure as the unavailable message", async () => {
    mocks.signIn.mockRejectedValue(new AuthenticationInternalFailure());

    await expect(loginAction({}, form())).resolves.toEqual({
      error: AUTHENTICATION_UNAVAILABLE,
    });
  });

  it("shows the correlation-ID reference for an unavailable failure", async () => {
    const correlationId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    mocks.signIn.mockRejectedValue(
      new AuthenticationUnavailable(correlationId),
    );

    await expect(loginAction({}, form())).resolves.toEqual({
      error: `Unable to sign in right now. Reference: ${correlationId}`,
    });
  });

  it("shows the correlation-ID reference for an internal failure", async () => {
    const correlationId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const state = await loginAction(
      {},
      (() => {
        mocks.signIn.mockRejectedValue(
          new AuthenticationInternalFailure(correlationId),
        );
        return form();
      })(),
    );
    expect(state.error).toContain(`Reference: ${correlationId}`);
    // Never leak provider, status, code, or configuration detail.
    expect(state.error).not.toMatch(/upstash|redis|401|token|config/i);
  });

  it("rethrows a generic non-credential Auth.js error instead of hiding it", async () => {
    // A bare AuthError is neither a credential rejection nor one of our safe
    // classifications, so it must not be masked as invalid credentials.
    const error = new AuthError("authentication failed");
    mocks.signIn.mockRejectedValue(error);

    await expect(loginAction({}, form())).rejects.toBe(error);
  });

  it.each([
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\\evil.example/admin",
    "/dashboard",
  ])("never forwards an unsafe callback URL: %s", async (callbackUrl) => {
    const signal = redirectSignal("/admin");
    mocks.signIn.mockRejectedValue(signal);

    await expect(loginAction({}, form(callbackUrl))).rejects.toBe(signal);
    expect(mocks.signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/admin" }),
    );
  });
});
