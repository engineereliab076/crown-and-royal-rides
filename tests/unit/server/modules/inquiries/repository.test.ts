import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_INQUIRY_SELECT,
  CREATED_INQUIRY_SELECT,
  createPrismaInquiryRepository,
  PURCHASE_VEHICLE_SELECT,
  type InquiryPrismaClient,
} from "@/server/modules/inquiries/repository";

function repositoryWith(
  vehicle: Record<string, unknown> = {},
  inquiry: Record<string, unknown> = {},
) {
  return createPrismaInquiryRepository({
    vehicle,
    inquiry,
  } as unknown as InquiryPrismaClient);
}

describe("Prisma inquiry repository", () => {
  it("selects only an available published sale vehicle", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await repositoryWith({ findFirst }).findPublishedVehicleForPurchase(
      "vehicle-id",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "vehicle-id",
        listingState: "published",
        isForSale: true,
        saleStatus: "available",
      },
      select: PURCHASE_VEHICLE_SELECT,
    });
    expect(PURCHASE_VEHICLE_SELECT).not.toHaveProperty("description");
    expect(PURCHASE_VEHICLE_SELECT).not.toHaveProperty("searchVector");
  });

  it("writes one purchase with all server-controlled fields fixed", async () => {
    const create = vi.fn().mockResolvedValue({});
    const subject = {
      vehicleId: "vehicle-id",
      slug: "toyota-prado",
      brandName: "Toyota",
      model: "Prado",
      year: 2025,
      salePrice: 100,
      driverOption: "without_driver",
    };
    await repositoryWith({}, { create }).createPurchaseInquiry({
      reference: "CRR-ABCDEFGH",
      vehicleId: "vehicle-id",
      subjectSnapshot: subject,
      customerName: "Asha",
      customerPhone: "+255712345678",
      customerEmail: null,
      message: null,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "purchase",
        status: "new",
        packageId: null,
        preferredViewingAt: null,
        subjectSnapshot: subject,
      }),
      select: CREATED_INQUIRY_SELECT,
    });
  });

  it("uses deterministic bounded admin pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await repositoryWith({}, { findMany, count }).listAdmin({
      page: 2,
      limit: 20,
    });
    expect(findMany).toHaveBeenCalledWith({
      select: ADMIN_INQUIRY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: 20,
      take: 20,
    });
  });
});
