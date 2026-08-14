import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { toShillings } from "@/lib/money";
import { AppError } from "@/server/http/errors";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import {
  toAdminInquiryListItemDTO,
  type AdminInquiryListItemDTO,
  type PurchaseSubjectSnapshot,
} from "@/server/modules/inquiries/dto";
import type { InquiryRepository } from "@/server/modules/inquiries/repository";
import {
  adminInquiryListQuerySchema,
  purchaseInquirySchema,
  type AdminInquiryListInput,
  type PurchaseInquiryInput,
} from "@/server/modules/inquiries/schemas";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INQUIRY_REFERENCE_PATTERN = /^CRR-[A-HJ-NP-Z2-9]{8}$/;

export interface PurchaseInquirySubmission {
  readonly reference: string;
  readonly createdAt: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  readonly message: string | null;
  readonly subject: PurchaseSubjectSnapshot;
}

export interface AdminInquiryPageDTO {
  readonly items: readonly AdminInquiryListItemDTO[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface InquiryService {
  submitPurchaseInquiry(
    input: PurchaseInquiryInput,
    context: { readonly correlationId: string },
  ): Promise<PurchaseInquirySubmission>;
  listAdmin(
    actor: AuthenticatedActor,
    query: AdminInquiryListInput,
  ): Promise<AdminInquiryPageDTO>;
}

export function generateInquiryReference(): string {
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) {
    suffix += REFERENCE_ALPHABET[byte & 31];
  }
  return `CRR-${suffix}`;
}

export function isInquiryReferenceUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return false;
  const modelName = (meta as { modelName?: unknown }).modelName;
  if (modelName !== undefined && modelName !== "Inquiry") return false;
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "reference";
  }
  return (
    typeof target === "string" &&
    /(^|_)inquiries?_reference(_key)?$|^reference$/.test(target)
  );
}

function invalidInput(): AppError {
  return new AppError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Invalid purchase request.",
  });
}

function unavailableVehicle(): AppError {
  return new AppError({
    status: 404,
    code: "VEHICLE_UNAVAILABLE",
    message: "This vehicle is not available for purchase.",
  });
}

function referenceUnavailable(): AppError {
  return new AppError({
    status: 503,
    code: "INQUIRY_REFERENCE_UNAVAILABLE",
    message: "Your request could not be saved. Please try again.",
  });
}

export function createInquiryService(input: {
  readonly repository: InquiryRepository;
  readonly createReference?: () => string;
}): InquiryService {
  const createReference = input.createReference ?? generateInquiryReference;

  return {
    async submitPurchaseInquiry(rawInput) {
      const parsed = purchaseInquirySchema.safeParse(rawInput);
      if (!parsed.success) throw invalidInput();

      const vehicle = await input.repository.findPublishedVehicleForPurchase(
        parsed.data.vehicleId,
      );
      if (vehicle === null || vehicle.salePrice === null) {
        throw unavailableVehicle();
      }

      const subject: PurchaseSubjectSnapshot = {
        vehicleId: vehicle.id,
        slug: vehicle.slug,
        brandName: vehicle.brandName,
        model: vehicle.model,
        year: vehicle.year,
        salePrice: toShillings(vehicle.salePrice),
        driverOption: vehicle.driverOption,
      };
      // Assert the immutable allow-listed snapshot is JSON-safe before writing.
      JSON.stringify(subject);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const reference = createReference();
        if (!INQUIRY_REFERENCE_PATTERN.test(reference)) {
          throw new TypeError(
            "Inquiry reference generator returned an invalid value.",
          );
        }
        if ((await input.repository.findReference(reference)) !== null) {
          if (attempt === 3) throw referenceUnavailable();
          continue;
        }

        try {
          const created = await input.repository.createPurchaseInquiry({
            reference,
            vehicleId: vehicle.id,
            subjectSnapshot: subject as Prisma.InputJsonObject,
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerEmail: parsed.data.customerEmail ?? null,
            message: parsed.data.message ?? null,
          });
          return {
            reference: created.reference,
            createdAt: created.createdAt.toISOString(),
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerEmail: parsed.data.customerEmail ?? null,
            message: parsed.data.message ?? null,
            subject,
          };
        } catch (error) {
          if (!isInquiryReferenceUniqueViolation(error)) throw error;
          if (attempt === 3) throw referenceUnavailable();
        }
      }
      throw new Error("Unreachable inquiry reference retry state.");
    },

    async listAdmin(actor, rawQuery) {
      requireCapability(actor, "inquiry:manage");
      const query = adminInquiryListQuerySchema.safeParse(rawQuery);
      if (!query.success) throw invalidInput();
      const page = await input.repository.listAdmin(query.data);
      return {
        ...page,
        items: page.items.map(toAdminInquiryListItemDTO),
      };
    },
  };
}
