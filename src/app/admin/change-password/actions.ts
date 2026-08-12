"use server";

import { redirect } from "next/navigation";

import { auth, signOut } from "@/server/auth";
import { getAuthServices } from "@/server/auth/services";
import { isAppError } from "@/server/http/errors";
import { assertSameOrigin } from "@/server/http/request-origin";
import { passwordChangeSchema } from "@/server/modules/auth/schemas";

export interface ChangePasswordState {
  readonly error?: string;
}

const REQUIREMENTS_FAILURE = "New password does not meet the requirements.";
const RATE_LIMITED =
  "Too many attempts. Please wait a few minutes and try again.";

/**
 * Change-password server action.
 *
 * Only authenticated administrators may use it. It validates input, verifies
 * the current password via the auth service, applies per-administrator rate
 * limiting, and rotates the password atomically (hash + forced-change flag +
 * session-version bump). On success the administrator is signed out and sent to
 * the login page with a safe success indicator. Neither password is ever
 * returned or logged.
 */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  await assertSameOrigin();

  const session = await auth();
  const user = session?.user;
  if (user === undefined) redirect("/admin/login");

  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return { error: REQUIREMENTS_FAILURE };

  const { authService, authRateLimiter } = getAuthServices();

  const decision = await authRateLimiter.checkPasswordChange({
    adminId: user.id,
  });
  if (!decision.allowed) return { error: RATE_LIMITED };

  try {
    await authService.changePassword({
      actorId: user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
  } catch (error) {
    if (isAppError(error)) {
      switch (error.code) {
        case "CURRENT_PASSWORD_INVALID":
          return { error: "Current password is incorrect." };
        case "PASSWORD_REUSED":
          return {
            error: "New password must be different from the current password.",
          };
        case "WEAK_PASSWORD":
          return { error: REQUIREMENTS_FAILURE };
        default:
          return { error: "Unable to change your password." };
      }
    }
    throw error;
  }

  // The session version was bumped, so the current session is already invalid;
  // sign out explicitly and send the user back to sign in again.
  await signOut({ redirect: false });
  redirect("/admin/login?status=password-changed");
}
