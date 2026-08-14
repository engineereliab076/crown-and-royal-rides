import { describe, expect, it, vi } from "vitest";

import type { InquiryRepository } from "@/server/modules/inquiries/repository";
import {
  createInquiryService,
  generateInquiryReference,
  INQUIRY_REFERENCE_PATTERN,
} from "@/server/modules/inquiries/service";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const VEHICLE = {
  id: VEHICLE_ID,
  slug: "toyota-prado-2025-test",
  brandName: "Toyota",
  model: "Prado",
  year: 2025,
  salePrice: BigInt(145_000_000),
  driverOption: "without_driver" as const,
};
const VALID = {
  vehicleId: VEHICLE_ID,
  customerName: "Asha Mrema",
  customerPhone: "0712345678",
};

function repository(
  overrides: Partial<InquiryRepository> = {},
): InquiryRepository {
  return {
    findPublishedVehicleForPurchase: vi.fn().mockResolvedValue(VEHICLE),
    findReference: vi.fn().mockResolvedValue(null),
    createPurchaseInquiry: vi.fn().mockImplementation(async (input) => ({
      id: "inquiry-id",
      reference: input.reference,
      createdAt: new Date("2026-08-14T01:00:00.000Z"),
    })),
    listAdmin: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    }),
    ...overrides,
  };
}

describe("inquiry service", () => {
  it("generates references in the fixed readable format", () => {
    expect(generateInquiryReference()).toMatch(INQUIRY_REFERENCE_PATTERN);
  });

  it("builds a JSON-safe snapshot exclusively from server vehicle data", async () => {
    const repo = repository();
    const result = await createInquiryService({
      repository: repo,
      createReference: () => "CRR-ABCDEFGH",
    }).submitPurchaseInquiry(VALID, { correlationId: "correlation" });
    expect(result.subject).toEqual({
      vehicleId: VEHICLE_ID,
      slug: VEHICLE.slug,
      brandName: "Toyota",
      model: "Prado",
      year: 2025,
      salePrice: 145_000_000,
      driverOption: "without_driver",
    });
    expect(() => JSON.stringify(result.subject)).not.toThrow();
    expect(result.subject).not.toHaveProperty("description");
    expect(result.subject).not.toHaveProperty("searchVector");
  });

  it("rejects missing, draft, sold, and unavailable vehicles safely", async () => {
    const service = createInquiryService({
      repository: repository({
        findPublishedVehicleForPurchase: vi.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.submitPurchaseInquiry(VALID, { correlationId: "correlation" }),
    ).rejects.toMatchObject({ status: 404, code: "VEHICLE_UNAVAILABLE" });
  });

  it("retries a reference collision and returns the persisted reference", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({
        code: "P2002",
        meta: { modelName: "Inquiry", target: ["reference"] },
      })
      .mockResolvedValue({
        id: "inquiry-id",
        reference: "CRR-BCDEFGHJ",
        createdAt: new Date(),
      });
    const refs = ["CRR-ABCDEFGH", "CRR-BCDEFGHJ"];
    const result = await createInquiryService({
      repository: repository({ createPurchaseInquiry: create }),
      createReference: () => refs.shift() ?? "CRR-CDEFGHJK",
    }).submitPurchaseInquiry(VALID, { correlationId: "correlation" });
    expect(result.reference).toBe("CRR-BCDEFGHJ");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated database errors", async () => {
    const create = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { modelName: "Inquiry", target: ["id"] },
    });
    await expect(
      createInquiryService({
        repository: repository({ createPurchaseInquiry: create }),
        createReference: () => "CRR-ABCDEFGH",
      }).submitPurchaseInquiry(VALID, { correlationId: "correlation" }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("authoritatively requires inquiry:manage for admin listing", async () => {
    const service = createInquiryService({ repository: repository() });
    await expect(
      service.listAdmin(
        { id: "actor", role: "viewer" as never },
        { page: 1, limit: 20 },
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});
