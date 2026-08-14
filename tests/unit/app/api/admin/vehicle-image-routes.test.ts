import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getGallery: vi.fn(),
  attach: vi.fn(),
  reorder: vi.fn(),
  setCover: vi.fn(),
  updateAltText: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/server/http/auth-guard", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/vehicle-images/services", () => ({
  getVehicleImageService: () => ({
    getGallery: mocks.getGallery,
    attach: mocks.attach,
    reorder: mocks.reorder,
    setCover: mocks.setCover,
    updateAltText: mocks.updateAltText,
    remove: mocks.remove,
  }),
}));

import { PATCH as altText } from "@/app/api/admin/vehicles/[id]/images/[imageId]/alt-text/route";
import { POST as setCover } from "@/app/api/admin/vehicles/[id]/images/[imageId]/cover/route";
import { DELETE as removeImage } from "@/app/api/admin/vehicles/[id]/images/[imageId]/route";
import { PATCH as reorder } from "@/app/api/admin/vehicles/[id]/images/reorder/route";
import {
  GET as listImages,
  POST as attachImage,
} from "@/app/api/admin/vehicles/[id]/images/route";

const ACTOR = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "owner" };
const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const IMAGE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const ORIGIN = "http://localhost:3000";

const IMAGE_DTO = {
  id: IMAGE_ID,
  url: "https://media.test.invalid/x.jpg",
  width: 1600,
  height: 900,
  format: "jpg",
  altText: "A description",
  sortOrder: 0,
  isCover: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const GALLERY = {
  images: [IMAGE_DTO],
  updatedAt: "2026-08-14T00:00:00.000Z",
};

function idContext() {
  return { params: Promise.resolve({ id: VEHICLE_ID }) };
}
function imageContext() {
  return { params: Promise.resolve({ id: VEHICLE_ID, imageId: IMAGE_ID }) };
}
function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost:3000${path}`, init);
}
function jsonInit(method: string, body?: unknown) {
  return {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({
    actor: ACTOR,
    mustChangePassword: false,
    sessionVersion: 1,
  });
  mocks.getGallery.mockResolvedValue(GALLERY);
  mocks.attach.mockResolvedValue(IMAGE_DTO);
  mocks.reorder.mockResolvedValue(GALLERY);
  mocks.setCover.mockResolvedValue(GALLERY);
  mocks.updateAltText.mockResolvedValue(IMAGE_DTO);
  mocks.remove.mockResolvedValue({ images: [], updatedAt: GALLERY.updatedAt });
});

describe("vehicle image gallery routes", () => {
  it("GET lists the gallery with 200 and private caching", async () => {
    const response = await listImages(
      request(`/api/admin/vehicles/${VEHICLE_ID}/images`),
      idContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ gallery: GALLERY });
    expect(mocks.getGallery).toHaveBeenCalledWith(ACTOR, {
      vehicleId: VEHICLE_ID,
    });
  });

  it("POST attaches with 201 and passes only upload + altText", async () => {
    const response = await attachImage(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images`,
        jsonInit("POST", {
          upload: { publicId: "p", version: 1, signature: "s" },
          altText: "Front view",
        }),
      ),
      idContext(),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ image: IMAGE_DTO });
    expect(mocks.attach.mock.calls[0]?.[1]).toEqual({
      vehicleId: VEHICLE_ID,
      upload: { publicId: "p", version: 1, signature: "s" },
      altText: "Front view",
    });
  });

  it("PATCH reorder passes the ordered ids and expectedUpdatedAt", async () => {
    const response = await reorder(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images/reorder`,
        jsonInit("PATCH", {
          imageIds: [IMAGE_ID],
          expectedUpdatedAt: GALLERY.updatedAt,
        }),
      ),
      idContext(),
    );
    expect(response.status).toBe(200);
    expect(mocks.reorder.mock.calls[0]?.[1]).toEqual({
      vehicleId: VEHICLE_ID,
      imageIds: [IMAGE_ID],
      expectedUpdatedAt: GALLERY.updatedAt,
    });
  });

  it("POST cover passes the vehicle, image, and expectedUpdatedAt", async () => {
    const response = await setCover(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images/${IMAGE_ID}/cover`,
        jsonInit("POST", { expectedUpdatedAt: GALLERY.updatedAt }),
      ),
      imageContext(),
    );
    expect(response.status).toBe(200);
    expect(mocks.setCover.mock.calls[0]?.[1]).toEqual({
      vehicleId: VEHICLE_ID,
      imageId: IMAGE_ID,
      expectedUpdatedAt: GALLERY.updatedAt,
    });
  });

  it("PATCH alt-text passes the trimmed alt text", async () => {
    const response = await altText(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images/${IMAGE_ID}/alt-text`,
        jsonInit("PATCH", { altText: "New" }),
      ),
      imageContext(),
    );
    expect(response.status).toBe(200);
    expect(mocks.updateAltText.mock.calls[0]?.[1]).toEqual({
      vehicleId: VEHICLE_ID,
      imageId: IMAGE_ID,
      altText: "New",
    });
  });

  it("DELETE removes and returns the refreshed gallery", async () => {
    const response = await removeImage(
      request(`/api/admin/vehicles/${VEHICLE_ID}/images/${IMAGE_ID}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      }),
      imageContext(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      gallery: { images: [], updatedAt: GALLERY.updatedAt },
    });
    expect(mocks.remove.mock.calls[0]?.[1]).toEqual({
      vehicleId: VEHICLE_ID,
      imageId: IMAGE_ID,
    });
  });

  it("enforces origin protection before authentication on mutations", async () => {
    const response = await attachImage(
      request(`/api/admin/vehicles/${VEHICLE_ID}/images`, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify({ upload: {}, altText: "x" }),
      }),
      idContext(),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "PASSWORD_CHANGE_REQUIRED"],
    [403, "FORBIDDEN"],
  ])("propagates %i protection errors from the guard", async (status, code) => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError({ status, code, message: "Denied." }),
    );
    const response = await reorder(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images/reorder`,
        jsonInit("PATCH", { imageIds: [IMAGE_ID], expectedUpdatedAt: "x" }),
      ),
      idContext(),
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it("surfaces a 409 stale conflict from the service safely", async () => {
    mocks.setCover.mockRejectedValue(
      new AppError({
        status: 409,
        code: "STALE_RECORD",
        message: "The vehicle changed since it was loaded.",
      }),
    );
    const response = await setCover(
      request(
        `/api/admin/vehicles/${VEHICLE_ID}/images/${IMAGE_ID}/cover`,
        jsonInit("POST", { expectedUpdatedAt: GALLERY.updatedAt }),
      ),
      imageContext(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RECORD" },
    });
  });
});
