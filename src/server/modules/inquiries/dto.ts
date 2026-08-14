import "server-only";

import { z } from "zod";

import type { AdminInquiryRecord } from "@/server/modules/inquiries/repository";

export const purchaseSubjectSnapshotSchema = z
  .object({
    vehicleId: z.uuid(),
    slug: z.string().min(1).max(200),
    brandName: z.string().min(1).max(120),
    model: z.string().min(1).max(80),
    year: z.number().int().min(1980).max(2100),
    salePrice: z.number().int().positive().safe(),
    driverOption: z.enum(["with_driver", "without_driver"]),
  })
  .strict();

export type PurchaseSubjectSnapshot = z.output<
  typeof purchaseSubjectSnapshotSchema
>;

export interface PurchaseInquiryResponseDTO {
  readonly reference: string;
  readonly message: string;
  readonly whatsappUrl: string | null;
}

export interface AdminInquiryListItemDTO {
  readonly id: string;
  readonly reference: string;
  readonly type: string;
  readonly status: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  readonly message: string | null;
  readonly subject: PurchaseSubjectSnapshot | null;
  readonly createdAt: string;
}

export function toSafePurchaseSubjectSnapshot(
  value: unknown,
): PurchaseSubjectSnapshot | null {
  const parsed = purchaseSubjectSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toAdminInquiryListItemDTO(
  record: AdminInquiryRecord,
): AdminInquiryListItemDTO {
  return {
    id: record.id,
    reference: record.reference,
    type: record.type,
    status: record.status,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    customerEmail: record.customerEmail,
    message: record.message,
    subject: toSafePurchaseSubjectSnapshot(record.subjectSnapshot),
    createdAt: record.createdAt.toISOString(),
  };
}
