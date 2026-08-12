import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  list: vi.fn(),
  createAdmin: vi.fn(),
  resetPassword: vi.fn(),
  auditList: vi.fn(),
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
}));

vi.mock("@/server/http/auth-guard", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/server/admin/services", () => ({
  getAdminServices: () => ({
    administratorService: {
      list: mocks.list,
      createAdmin: mocks.createAdmin,
      resetPassword: mocks.resetPassword,
    },
    auditLogService: { list: mocks.auditList },
    settingsService: {
      get: mocks.settingsGet,
      update: mocks.settingsUpdate,
    },
    createRequestAuditContext: () => ({
      correlationId: "route-correlation",
      ipHash: "hashed-ip",
    }),
  }),
}));

import {
  GET as listAdministrators,
  POST as createAdministrator,
} from "@/app/api/admin/users/route";
import { POST as resetPassword } from "@/app/api/admin/users/[id]/reset-password/route";
import { POST as deactivateAdministrator } from "@/app/api/admin/users/[id]/deactivate/route";
import { POST as reactivateAdministrator } from "@/app/api/admin/users/[id]/reactivate/route";
import { PATCH as setAdministratorRole } from "@/app/api/admin/users/[id]/role/route";
import { GET as listAuditRecords } from "@/app/api/admin/audit-log/route";
import {
  GET as getSettings,
  PUT as updateSettings,
} from "@/app/api/admin/settings/route";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TARGET_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const routeContext = { params: Promise.resolve({ id: TARGET_ID }) };
const noContext = undefined as never;
const VALID_SETTINGS_INPUT = {
  businessName: "Crown Test Rides",
  whatsappNumber: "+255712345678",
  primaryPhone: "+255712345678",
  secondaryPhone: "",
  email: "hello@example.test",
  address: "Test address",
  openingHours: { monday: "08:00-17:00" },
  socialLinks: { instagram: "https://example.test/social" },
  heroHeadline: "Test headline",
  heroSubheadline: "Test subheadline",
  inquiryNotificationEmails: ["inquiries@example.test"],
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({
    actor: { id: OWNER_ID, role: AdminRole.owner },
    mustChangePassword: false,
    sessionVersion: 1,
  });
  mocks.list.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });
  mocks.auditList.mockResolvedValue({ items: [], nextCursor: null });
  mocks.createAdmin.mockResolvedValue({
    administrator: { id: TARGET_ID, email: "new@example.com" },
    temporaryPassword: "Temporary-Password-9!",
  });
  mocks.resetPassword.mockResolvedValue({
    administrator: { id: TARGET_ID },
    temporaryPassword: "Temporary-Password-8!",
  });
  mocks.settingsGet.mockResolvedValue(VALID_SETTINGS_INPUT);
  mocks.settingsUpdate.mockResolvedValue(VALID_SETTINGS_INPUT);
});

describe("administrator API protection and validation", () => {
  it("returns 401 for anonymous access to every implemented admin endpoint", async () => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({
        status: 401,
        code: "AUTH_REQUIRED",
        message: "Authentication required.",
      }),
    );
    const originHeaders = { Origin: "http://localhost:3000" };
    const requests: Array<() => Promise<Response>> = [
      () => listAdministrators(request("/api/admin/users"), noContext),
      () =>
        createAdministrator(
          request("/api/admin/users", {
            method: "POST",
            headers: originHeaders,
          }),
          noContext,
        ),
      () =>
        setAdministratorRole(
          request(`/api/admin/users/${TARGET_ID}/role`, {
            method: "PATCH",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        deactivateAdministrator(
          request(`/api/admin/users/${TARGET_ID}/deactivate`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        reactivateAdministrator(
          request(`/api/admin/users/${TARGET_ID}/reactivate`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        resetPassword(
          request(`/api/admin/users/${TARGET_ID}/reset-password`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () => listAuditRecords(request("/api/admin/audit-log"), noContext),
      () => getSettings(request("/api/admin/settings"), noContext),
      () =>
        updateSettings(
          request("/api/admin/settings", {
            method: "PUT",
            headers: originHeaders,
          }),
          noContext,
        ),
    ];
    for (const invoke of requests) {
      const response = await invoke();
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "AUTH_REQUIRED" },
      });
    }
  });

  it("returns 403 for a manager on administrator, audit, and settings endpoints", async () => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({
        status: 403,
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
      }),
    );
    const originHeaders = { Origin: "http://localhost:3000" };
    const requests: Array<() => Promise<Response>> = [
      () => listAdministrators(request("/api/admin/users"), noContext),
      () =>
        createAdministrator(
          request("/api/admin/users", {
            method: "POST",
            headers: originHeaders,
          }),
          noContext,
        ),
      () =>
        setAdministratorRole(
          request(`/api/admin/users/${TARGET_ID}/role`, {
            method: "PATCH",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        deactivateAdministrator(
          request(`/api/admin/users/${TARGET_ID}/deactivate`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        reactivateAdministrator(
          request(`/api/admin/users/${TARGET_ID}/reactivate`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () =>
        resetPassword(
          request(`/api/admin/users/${TARGET_ID}/reset-password`, {
            method: "POST",
            headers: originHeaders,
          }),
          routeContext,
        ),
      () => listAuditRecords(request("/api/admin/audit-log"), noContext),
      () => getSettings(request("/api/admin/settings"), noContext),
      () =>
        updateSettings(
          request("/api/admin/settings", {
            method: "PUT",
            headers: originHeaders,
          }),
          noContext,
        ),
    ];
    for (const invoke of requests) {
      expect((await invoke()).status).toBe(403);
    }
    expect(mocks.auditList).not.toHaveBeenCalled();
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
  });

  it("keeps non-GET same-origin validation active", async () => {
    const response = await createAdministrator(
      request("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({
          email: "new@example.com",
          name: "New Admin",
          role: "manager",
        }),
      }),
      noContext,
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("rejects unknown actor fields with the standard safe envelope", async () => {
    const response = await createAdministrator(
      request("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "new@example.com",
          name: "New Admin",
          role: "manager",
          actorId: "attacker-supplied",
        }),
      }),
      noContext,
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(JSON.stringify(body)).not.toContain("attacker-supplied");
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("returns a temporary password once without a password hash and disables caching", async () => {
    const response = await createAdministrator(
      request("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "new@example.com",
          name: "New Admin",
          role: "manager",
        }),
      }),
      noContext,
    );
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(text).toContain("Temporary-Password-9!");
    expect(text).not.toContain("passwordHash");
    expect(mocks.createAdmin.mock.calls[0]?.[0]).toEqual({
      id: OWNER_ID,
      role: AdminRole.owner,
    });
  });

  it("returns reset plaintext but never a hash", async () => {
    const response = await resetPassword(
      request(`/api/admin/users/${TARGET_ID}/reset-password`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      }),
      routeContext,
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("Temporary-Password-8!");
    expect(text).not.toContain("passwordHash");
  });

  it("updates settings with private caching and the validated session actor", async () => {
    const response = await updateSettings(
      request("/api/admin/settings", {
        method: "PUT",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(VALID_SETTINGS_INPUT),
      }),
      noContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.settingsUpdate.mock.calls[0]?.[0]).toEqual({
      id: OWNER_ID,
      role: AdminRole.owner,
    });
  });
});
