import { describe, expect, it } from "vitest";

import {
  adminIdSchema,
  emailSchema,
  loginCredentialsSchema,
  normalizeEmail,
  passwordChangeSchema,
} from "@/server/modules/auth/schemas";

const VALID_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("emailSchema / normalizeEmail", () => {
  it("accepts and normalizes a valid email", () => {
    const result = emailSchema.parse("  Owner@Example.COM  ");
    expect(result).toBe("owner@example.com");
  });

  it("keeps normalizeEmail consistent with the schema", () => {
    expect(normalizeEmail("  Owner@Example.COM  ")).toBe("owner@example.com");
  });

  it.each([
    "",
    "   ",
    "not-an-email",
    "no@domain",
    "@example.com",
    "a@b c.com",
  ])("rejects an invalid or blank email %j", (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe("adminIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(adminIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each(["", "123", "not-a-uuid", VALID_UUID.slice(0, -1)])(
    "rejects an invalid administrator ID %j",
    (value) => {
      expect(adminIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("loginCredentialsSchema", () => {
  it("accepts valid credentials and normalizes the email", () => {
    const result = loginCredentialsSchema.parse({
      email: "  Admin@Example.COM ",
      password: "any-non-blank",
    });
    expect(result).toEqual({
      email: "admin@example.com",
      password: "any-non-blank",
    });
  });

  it("rejects a blank password", () => {
    expect(
      loginCredentialsSchema.safeParse({
        email: "admin@example.com",
        password: "",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      loginCredentialsSchema.safeParse({
        email: "nope",
        password: "any-non-blank",
      }).success,
    ).toBe(false);
  });

  it.each([
    "passwordHash",
    "sessionVersion",
    "isActive",
    "createdAt",
    "updatedAt",
    "role",
  ])("rejects the server-controlled field %s", (field) => {
    const result = loginCredentialsSchema.safeParse({
      email: "admin@example.com",
      password: "any-non-blank",
      [field]: "attacker-supplied",
    });
    expect(result.success).toBe(false);
  });
});

describe("passwordChangeSchema", () => {
  it("accepts a policy-compliant change", () => {
    const result = passwordChangeSchema.parse({
      currentPassword: "old-password-1",
      newPassword: "new-strong-password-1",
    });
    expect(result.newPassword).toBe("new-strong-password-1");
  });

  it("rejects a weak (too short) new password", () => {
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: "old-password-1",
        newPassword: "short",
      }).success,
    ).toBe(false);
  });

  it("rejects an unchanged new password", () => {
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: "same-password-123",
        newPassword: "same-password-123",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: "old-password-1",
        newPassword: "new-strong-password-1",
        passwordHash: "attacker-supplied",
      }).success,
    ).toBe(false);
  });
});

describe("validation errors never leak secrets", () => {
  it("omits the supplied password from login validation errors", () => {
    const marker = "PLAINTEXT_LEAK_MARKER_password";
    const result = loginCredentialsSchema.safeParse({
      email: "not-an-email",
      password: marker,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain(marker);
    }
  });

  it("omits the supplied password from password-change validation errors", () => {
    const marker = "PLAINTEXT_LEAK_MARKER_new";
    const result = passwordChangeSchema.safeParse({
      currentPassword: "old-password-1",
      newPassword: marker.slice(0, 5),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain(
        marker.slice(0, 5),
      );
    }
  });
});
