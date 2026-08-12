"use server";

import { signOut } from "@/server/auth";

/**
 * Logout server action. Invoked via a POST form (never a state-changing GET);
 * Next.js applies its Server Action origin/CSRF protection. It clears the
 * session cookie through Auth.js and redirects to the login page.
 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/admin/login" });
}
