import { describe, expect, it } from "vitest";

import { parseLoginCredentials } from "@/server/auth/credentials";
import { loginCredentialsSchema } from "@/server/modules/auth/schemas";

const EMAIL = "owner@example.com";
const PASSWORD = "owner-password-123";

/**
 * Regression coverage for the live Auth.js delivery path: `signIn()` appends a
 * `callbackUrl` control field to the credentials body, so the object handed to
 * `authorize` is `{ email, password, callbackUrl }`. The root-cause bug passed
 * that whole object to the strict login schema, which rejected the unknown
 * `callbackUrl` key and returned null — a generic CredentialsSignin — before
 * verification ever ran.
 */
describe("parseLoginCredentials", () => {
  it("documents why the whole Auth.js body fails the strict schema", () => {
    const authjsBody = {
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: "/admin",
    };
    // This is exactly the object Auth.js delivers, and the strict schema rejects
    // it because of the injected control field.
    expect(loginCredentialsSchema.safeParse(authjsBody).success).toBe(false);
  });

  it("validates credentials even when Auth.js injects a callbackUrl field", () => {
    const parsed = parseLoginCredentials({
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: "/admin",
    });

    expect(parsed).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("ignores additional control fields such as csrfToken and redirectTo", () => {
    const parsed = parseLoginCredentials({
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: "/admin/users",
      csrfToken: "abc.def",
      redirectTo: "/admin",
    });

    expect(parsed).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("normalizes the email exactly as the strict schema would", () => {
    const parsed = parseLoginCredentials({
      email: "  OWNER@Example.COM ",
      password: PASSWORD,
      callbackUrl: "/admin",
    });

    expect(parsed).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("returns null for a genuinely malformed email", () => {
    expect(
      parseLoginCredentials({ email: "not-an-email", password: PASSWORD }),
    ).toBeNull();
  });

  it("returns null when the password is missing", () => {
    expect(parseLoginCredentials({ email: EMAIL })).toBeNull();
  });

  it("returns null for non-object credentials without throwing", () => {
    expect(parseLoginCredentials(undefined)).toBeNull();
    expect(parseLoginCredentials(null)).toBeNull();
    expect(parseLoginCredentials("email=owner@example.com")).toBeNull();
  });
});
