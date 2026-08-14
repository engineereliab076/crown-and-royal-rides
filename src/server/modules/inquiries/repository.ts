import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  InquiryStatus,
  InquiryType,
  ListingState,
  SaleStatus,
} from "@/generated/prisma/enums";

export const PURCHASE_VEHICLE_SELECT = {
  id: true,
  slug: true,
  brandName: true,
  model: true,
  year: true,
  salePrice: true,
  driverOption: true,
} as const satisfies Prisma.VehicleSelect;

export const CREATED_INQUIRY_SELECT = {
  id: true,
  reference: true,
  createdAt: true,
} as const satisfies Prisma.InquirySelect;

export const ADMIN_INQUIRY_SELECT = {
  id: true,
  reference: true,
  type: true,
  status: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  message: true,
  subjectSnapshot: true,
  createdAt: true,
} as const satisfies Prisma.InquirySelect;

export type PublishedPurchaseVehicleRecord = Prisma.VehicleGetPayload<{
  select: typeof PURCHASE_VEHICLE_SELECT;
}>;
export type CreatedInquiryRecord = Prisma.InquiryGetPayload<{
  select: typeof CREATED_INQUIRY_SELECT;
}>;
export type AdminInquiryRecord = Prisma.InquiryGetPayload<{
  select: typeof ADMIN_INQUIRY_SELECT;
}>;

export interface CreatePurchaseInquiryRecord {
  readonly reference: string;
  readonly vehicleId: string;
  readonly subjectSnapshot: Prisma.InputJsonValue;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  readonly message: string | null;
}

export interface AdminInquiryPageRecord {
  readonly items: readonly AdminInquiryRecord[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface InquiryRepository {
  findPublishedVehicleForPurchase(
    vehicleId: string,
  ): Promise<PublishedPurchaseVehicleRecord | null>;
  createPurchaseInquiry(
    input: CreatePurchaseInquiryRecord,
  ): Promise<CreatedInquiryRecord>;
  findReference(reference: string): Promise<{ readonly id: string } | null>;
  listAdmin(input: {
    page: number;
    limit: number;
  }): Promise<AdminInquiryPageRecord>;
}

export type InquiryPrismaClient = Pick<PrismaClient, "vehicle" | "inquiry">;

export function createPrismaInquiryRepository(
  client: InquiryPrismaClient,
): InquiryRepository {
  return {
    async findPublishedVehicleForPurchase(vehicleId) {
      return client.vehicle.findFirst({
        where: {
          id: vehicleId,
          listingState: ListingState.published,
          isForSale: true,
          saleStatus: SaleStatus.available,
        },
        select: PURCHASE_VEHICLE_SELECT,
      });
    },

    async createPurchaseInquiry(input) {
      return client.inquiry.create({
        data: {
          reference: input.reference,
          type: InquiryType.purchase,
          status: InquiryStatus.new,
          vehicleId: input.vehicleId,
          packageId: null,
          subjectSnapshot: input.subjectSnapshot,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          message: input.message,
          preferredViewingAt: null,
        },
        select: CREATED_INQUIRY_SELECT,
      });
    },

    async findReference(reference) {
      return client.inquiry.findUnique({
        where: { reference },
        select: { id: true },
      });
    },

    async listAdmin(input) {
      const [items, total] = await Promise.all([
        client.inquiry.findMany({
          select: ADMIN_INQUIRY_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        client.inquiry.count(),
      ]);
      return { items, total, page: input.page, limit: input.limit };
    },
  };
}
