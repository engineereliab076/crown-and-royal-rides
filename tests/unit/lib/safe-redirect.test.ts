import { describe, expect, it } from "vitest";

import { resolveSafeAdminPath } from "@/lib/safe-redirect";

describe("resolveSafeAdminPath", () => {
  it("accepts internal admin paths", () => {
    expect(resolveSafeAdminPath("/admin")).toBe("/admin");
    expect(resolveSafeAdminPath("/admin/change-password")).toBe(
      "/admin/change-password",
    );
    expect(resolveSafeAdminPath("/admin/brands?page=2")).toBe(
      "/admin/brands?page=2",
    );
  });

  it.each([
    ["external URL", "https://evil.example.com/admin"],
    ["protocol-relative", "//evil.example.com"],
    ["backslash smuggling", "/\\evil.example.com"],
    ["embedded absolute URL", "/admin/../https://evil.example.com"],
    ["non-admin path", "/dashboard"],
    ["root", "/"],
    ["relative", "admin"],
    ["empty", ""],
    ["whitespace", "   "],
  ])("rejects %s and falls back to /admin", (_label, value) => {
    expect(resolveSafeAdminPath(value)).toBe("/admin");
  });

  it("rejects non-string input", () => {
    expect(resolveSafeAdminPath(undefined)).toBe("/admin");
    expect(resolveSafeAdminPath(null)).toBe("/admin");
    expect(resolveSafeAdminPath(["/admin/x"])).toBe("/admin");
  });

  it("honors a custom fallback", () => {
    expect(resolveSafeAdminPath("nope", "/admin/login")).toBe("/admin/login");
  });
});
