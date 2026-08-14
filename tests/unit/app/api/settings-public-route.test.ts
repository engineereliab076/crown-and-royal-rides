import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPublicSettings: vi.fn() }));

vi.mock("@/server/settings/services", () => ({
  getPublicSettings: mocks.getPublicSettings,
}));

import { GET } from "@/app/api/settings/public/route";

const publicSettings = {
  businessName: "Crown and Royal Rides",
  whatsappNumber: "+255700000000",
  primaryPhone: "+255700000001",
  secondaryPhone: null,
  email: "hello@example.test",
  address: "Dar es Salaam",
  openingHours: { monday: "09:00-17:00" },
  socialLinks: {},
  heroHeadline: "Find your next vehicle",
  heroSubheadline: "Safe and simple",
};

describe("GET /api/settings/public", () => {
  beforeEach(() => mocks.getPublicSettings.mockResolvedValue(publicSettings));

  it("returns only the approved public DTO with shared-cache headers", async () => {
    const response = await GET(
      new Request("http://localhost/api/settings/public"),
      undefined as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=300");
    const body = await response.json();
    expect(body).toEqual({ settings: publicSettings });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(
      /inquiryNotificationEmails|updatedBy|updatedAt/,
    );
  });
});
