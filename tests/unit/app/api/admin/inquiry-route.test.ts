import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listAdmin: vi.fn(),
}));

vi.mock("@/server/http/auth-guard", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/admin/services", () => ({
  getAdminServices: () => ({
    inquiryService: { listAdmin: mocks.listAdmin },
  }),
}));

import { GET } from "@/app/api/admin/inquiries/route";

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({
    actor: { id: "actor", role: "owner" },
    mustChangePassword: false,
    sessionVersion: 1,
  });
  mocks.listAdmin.mockResolvedValue({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
  });
});

describe("GET /api/admin/inquiries", () => {
  it("requires inquiry capability and returns private bounded data", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/admin/inquiries?page=1&limit=20"),
      undefined as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.requireAdmin).toHaveBeenCalledWith({
      capability: "inquiry:manage",
    });
    expect(mocks.listAdmin).toHaveBeenCalledWith(
      { id: "actor", role: "owner" },
      { page: "1", limit: "20" },
    );
  });

  it("rejects unauthorized access before listing", async () => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({ status: 403, code: "FORBIDDEN", message: "Denied." }),
    );
    const response = await GET(
      new Request("http://localhost:3000/api/admin/inquiries"),
      undefined as never,
    );
    expect(response.status).toBe(403);
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });

  it("rejects unbounded or unknown query input", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/api/admin/inquiries?limit=101&status=closed",
      ),
      undefined as never,
    );
    expect(response.status).toBe(422);
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });
});
