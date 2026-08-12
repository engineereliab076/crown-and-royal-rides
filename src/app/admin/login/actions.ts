"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";

import { resolveSafeAdminPath } from "@/lib/safe-redirect";
import { signIn } from "@/server/auth";
import { loginCredentialsSchema } from "@/server/modules/auth/schemas";

export interface LoginState {
  readonly error?: string;
}

const GENERIC_FAILURE = "Invalid email or password.";
const RATE_LIMITED =
  "Too many attempts. Please wait a few minutes and try again.";

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

  let result: unknown;
  try {
    result = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return { error: RATE_LIMITED };
    }
    if (error instanceof AuthError) return { error: GENERIC_FAILURE };
    throw error;
  }

  // With `redirect: false`, a failed authorize returns the login URL carrying an
  // error (and code) query parameter rather than throwing.
  if (typeof result === "string") {
    if (result.includes("code=rate_limited")) return { error: RATE_LIMITED };
    if (result.includes("error=")) return { error: GENERIC_FAILURE };
  }

  redirect(callbackUrl);
}
