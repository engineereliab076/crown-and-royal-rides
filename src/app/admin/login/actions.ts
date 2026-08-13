"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { unstable_rethrow } from "next/navigation";

import { resolveSafeAdminPath } from "@/lib/safe-redirect";
import { signIn } from "@/server/auth";
import {
  AuthenticationInternalFailure,
  AuthenticationUnavailable,
} from "@/server/auth/errors";
import { loginCredentialsSchema } from "@/server/modules/auth/schemas";

export interface LoginState {
  readonly error?: string;
}

const GENERIC_FAILURE = "Invalid email or password.";
const RATE_LIMITED =
  "Too many attempts. Please wait a few minutes and try again.";
const AUTHENTICATION_UNAVAILABLE =
  "Unable to sign in right now. Please try again shortly.";

/**
 * Login server action. Validates input, delegates to Auth.js `signIn`, and maps
 * every credential rejection to a single generic message. A rate-limit lockout
 * (fail-closed) surfaces a distinct, account-neutral message. Passwords are
 * never logged and never appear in the URL. On success the browser is
 * redirected to a safe internal path; the protected layout then re-routes
 * forced-change users to the change-password page.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const callbackUrl = resolveSafeAdminPath(formData.get("callbackUrl"));

  const parsed = loginCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_FAILURE };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    // Auth.js completes a successful server-action sign-in by throwing Next's
    // redirect signal. Preserve framework control flow before translating
    // genuine authentication failures into safe form state.
    unstable_rethrow(error);

    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return { error: RATE_LIMITED };
    }
    if (error instanceof CredentialsSignin) return { error: GENERIC_FAILURE };
    if (
      error instanceof AuthenticationUnavailable ||
      error instanceof AuthenticationInternalFailure
    ) {
      return { error: AUTHENTICATION_UNAVAILABLE };
    }
    if (error instanceof AuthError) throw error;
    throw error;
  }

  throw new Error("Auth.js sign-in completed without redirecting.");
}
