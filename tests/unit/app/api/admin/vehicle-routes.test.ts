import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  create: vi.fn(),
  listAdmin: vi.fn(),
  getAdminById: vi.fn(),
  publish: vi.fn(),
  createUploadAuthorization: vi.fn(),
}));

vi.mock("@/server/http/auth-guard", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/admin/services", () => ({
  getAdminServices: () => ({
    vehicleService: {
      create: mocks.create,
      listAdmin: mocks.listAdmin,
      getAdminById: mocks.getAdminById,
      publish: mocks.publish,
    },
  }),
}));
vi.mock("@/server/vehicle-images/services", () => ({
  getVehicleImageService: () => ({
    createUploadAuthorization: mocks.createUploadAuthorization,
  }),
}));

import { GET as getVehicle } from "@/app/api/admin/vehicles/[id]/route";
import { POST as publishVehicle } from "@/app/api/admin/vehicles/[id]/publish/route";
import { POST as createMediaSignature } from "@/app/api/admin/media/signature/route";
import {
  GET as listVehicles,
  POST as createVehicle,
} from "@/app/api/admin/vehicles/route";

const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const noContext = undefined as never;
const context = { params: Promise.resolve({ id: VEHICLE_ID }) };
const DTO = {
  id: VEHICLE_ID,
  brandName: "Toyota",
  model: "Land Cruiser",
  salePrice: 150_000_000,
};
const VALID = {
  brandId: ACTOR_ID,
  model: "Land Cruiser",
  year: 2025,
  bodyType: "suv",
  condition: "foreign_used",
  transmission: "automatic",
  fuelType: "diesel",
  driverOption: "without_driver",
  isForSale: true,
  saleStatus: "available",
  salePrice: 150_000_000,
  description: "Draft",
};

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({
    actor: { id: ACTOR_ID, role: "owner" },
    mustChangePassword: false,
    sessionVersion: 1,
  });
  mocks.create.mockResolvedValue(DTO);
  mocks.listAdmin.mockResolvedValue({
    items: [DTO],
    page: 1,
    limit: 20,
    total: 1,
  });
  mocks.getAdminById.mockResolvedValue(DTO);
  mocks.publish.mockResolvedValue(DTO);
  mocks.createUploadAuthorization.mockResolvedValue({
    uploadUrl: "https://uploads.test.invalid/direct",
    apiKey: "public-key",
    publicId: `dev/vehicles/vehicle/${VEHICLE_ID}/asset-id`,
    uploadPublicId: "asset-id",
    folder: `dev/vehicles/vehicle/${VEHICLE_ID}`,
    resourceType: "image",
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
    maxBytes: 10 * 1024 * 1024,
    maxWidth: 6000,
    maxHeight: 6000,
    transformation: "c_limit,w_6000,h_6000",
    timestamp: 1000,
    expiresAt: 1300,
    signature: "safe-signature",
  });
});

describe("vehicle admin routes", () => {
  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "PASSWORD_CHANGE_REQUIRED"],
    [403, "FORBIDDEN"],
  ])("returns %i protection errors safely", async (status, code) => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({ status, code, message: "Access denied." }),
    );
    const response = await listVehicles(
      request("/api/admin/vehicles"),
      noContext,
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });

  it("creates with 201, private caching, and a JSON-serializable DTO only", async () => {
    const response = await createVehicle(
      request("/api/admin/vehicles", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(VALID),
      }),
      noContext,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ vehicle: DTO });
    expect(mocks.create).toHaveBeenCalledWith(
      { id: ACTOR_ID, role: "owner" },
      VALID,
    );
  });

  it("rejects invalid create input without calling the service", async () => {
    const response = await createVehicle(
      request("/api/admin/vehicles", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...VALID, slug: "attacker-value" }),
      }),
      noContext,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns 422 publication readiness details safely", async () => {
    mocks.publish.mockRejectedValue(
      new AppError({
        status: 422,
        code: "VEHICLE_NOT_READY",
        message: "The vehicle is not ready to publish.",
        details: { missing: ["coverImage"] },
      }),
    );
    const response = await publishVehicle(
      request(`/api/admin/vehicles/${VEHICLE_ID}/publish`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      }),
      context,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VEHICLE_NOT_READY",
        details: { missing: ["coverImage"] },
      },
    });
  });

  it("serves admin detail with 200 and private caching", async () => {
    const response = await getVehicle(
      request(`/api/admin/vehicles/${VEHICLE_ID}`),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ vehicle: DTO });
  });

  it("keeps origin protection active before authentication", async () => {
    const response = await createVehicle(
      request("/api/admin/vehicles", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify(VALID),
      }),
      noContext,
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "PASSWORD_CHANGE_REQUIRED"],
    [403, "FORBIDDEN"],
  ])("protects the signature route with %i", async (status, code) => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({ status, code, message: "Access denied." }),
    );
    const response = await createMediaSignature(
      request("/api/admin/media/signature", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vehicleId: VEHICLE_ID }),
      }),
      noContext,
    );
    expect(response.status).toBe(status);
    expect(mocks.createUploadAuthorization).not.toHaveBeenCalled();
  });

  it("returns a safe, private upload authorization and never a secret", async () => {
    const response = await createMediaSignature(
      request("/api/admin/media/signature", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vehicleId: VEHICLE_ID }),
      }),
      noContext,
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(text).toContain("safe-signature");
    expect(text).not.toContain("apiSecret");
    expect(mocks.requireAdmin).toHaveBeenCalledWith({
      capability: "media:manage",
    });
  });

  it("rejects invalid signature input and applies origin protection", async () => {
    const invalid = await createMediaSignature(
      request("/api/admin/media/signature", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vehicleId: "invalid", folder: "attacker" }),
      }),
      noContext,
    );
    expect(invalid.status).toBe(422);
    const wrongOrigin = await createMediaSignature(
      request("/api/admin/media/signature", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify({ vehicleId: VEHICLE_ID }),
      }),
      noContext,
    );
    expect(wrongOrigin.status).toBe(403);
  });
});
