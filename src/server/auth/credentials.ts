import "server-only";

import {
  loginCredentialsSchema,
  type LoginCredentials,
} from "@/server/modules/auth/schemas";

/**
 * Extract and validate the login credential fields from the raw object Auth.js
 * hands to the Credentials `authorize` callback.
 *
 * Auth.js delivers the *entire* sign-in body to `authorize`, and its own
 * `signIn()` helper always appends a `callbackUrl` control field (see
 * `next-auth/lib/actions.ts`). The login schema is deliberately `.strict()` so
 * the HTTP layer rejects server-controlled columns, which means passing the
 * whole body straight to it makes every real submission fail on that injected
 * `callbackUrl` — surfacing as a generic `CredentialsSignin` ("Invalid email or
 * password.") before verification ever runs.
 *
 * Selecting `email`/`password` explicitly keeps the strict schema (and its
 * normalization + presence rules) while tolerating Auth.js's control fields. No
 * extra field is ever admitted into the credential object.
 */
export function parseLoginCredentials(
  credentials: unknown,
): LoginCredentials | null {
  const source =
    typeof credentials === "object" && credentials !== null
      ? (credentials as Record<string, unknown>)
      : {};

  const parsed = loginCredentialsSchema.safeParse({
    email: source.email,
    password: source.password,
  });
  return parsed.success ? parsed.data : null;
}
