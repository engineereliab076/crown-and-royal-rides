import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  administratorDisplayData,
  oneTimePasswordReducer,
} from "@/components/admin/users-page-state";

const ADMIN = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  email: "safe@example.test",
  name: "Safe Administrator",
  role: "manager" as const,
  isActive: true,
  mustChangePassword: true,
  sessionVersion: 2,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("users page safety", () => {
  it("renders safe administrator data without password hashes", () => {
    const display = administratorDisplayData(ADMIN);
    expect(display.name).toBe("Safe Administrator");
    expect(display.email).toBe("safe@example.test");
    expect(display).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(display)).not.toContain("argon2");
  });

  it("shows a temporary password once and clears it on close", () => {
    const shown = oneTimePasswordReducer(
      { open: false, value: null, administratorName: "" },
      {
        type: "show",
        value: "one-time-value",
        administratorName: "Safe Administrator",
      },
    );
    expect(shown).toEqual({
      open: true,
      value: "one-time-value",
      administratorName: "Safe Administrator",
    });
    expect(oneTimePasswordReducer(shown, { type: "clear" })).toEqual({
      open: false,
      value: null,
      administratorName: "",
    });
  });

  it("never writes temporary passwords to storage, cookies, URLs, or toast text", () => {
    const source = readFileSync(
      "src/components/admin/users-page-client.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(source).not.toMatch(
      /searchParams.*temporaryPassword|URL.*temporaryPassword/,
    );
    expect(source).not.toMatch(/toast\.[a-z]+\([^)]*temporaryPassword/);
    expect(source).not.toContain("console.");
  });
});
