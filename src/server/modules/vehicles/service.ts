import "server-only";

import { randomBytes } from "node:crypto";

import { ListingState } from "@/generated/prisma/enums";
import { toBigIntShillings } from "@/lib/money";
import { createVehicleSlug } from "@/lib/slug";
import { AppError } from "@/server/http/errors";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import {
  publicationRequirements,
  toVehicleAdminDTO,
  toVehiclePublicDetailDTO,
  type VehicleAdminDTO,
  type VehiclePublicDetailDTO,
} from "@/server/modules/vehicles/dto";
import type {
  VehicleBrandRecord,
  VehicleRepository,
} from "@/server/modules/vehicles/repository";
import {
  createVehicleSchema,
  vehicleIdSchema,
  vehicleListQuerySchema,
  vehicleSlugSchema,
  type CreateVehicleInput,
  type VehicleListInput,
} from "@/server/modules/vehicles/schemas";

export interface VehicleAdminPageDTO {
  readonly items: readonly VehicleAdminDTO[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface VehiclePublishContext {
  readonly correlationId: string;
  readonly actorId: string;
}

export interface VehicleService {
  create(
    actor: AuthenticatedActor,
    input: CreateVehicleInput,
  ): Promise<VehicleAdminDTO>;
  publish(
    actor: AuthenticatedActor,
    vehicleId: string,
    context?: VehiclePublishContext,
  ): Promise<VehicleAdminDTO>;
  getPublicBySlug(slug: string): Promise<VehiclePublicDetailDTO>;
  getAdminById(
    actor: AuthenticatedActor,
    vehicleId: string,
  ): Promise<VehicleAdminDTO>;
  listAdmin(
    actor: AuthenticatedActor,
    query: VehicleListInput,
  ): Promise<VehicleAdminPageDTO>;
  listBrands(actor: AuthenticatedActor): Promise<readonly VehicleBrandRecord[]>;
}

function validationError(message: string): AppError {
  return new AppError({ status: 422, code: "VALIDATION_ERROR", message });
}

function notFound(): AppError {
  return new AppError({
    status: 404,
    code: "VEHICLE_NOT_FOUND",
    message: "Vehicle not found.",
  });
}

function isSlugUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return false;
  const modelName =
    "modelName" in meta
      ? (meta as { modelName?: unknown }).modelName
      : undefined;
  if (modelName !== undefined && modelName !== "Vehicle") return false;
  const target =
    "target" in meta ? (meta as { target?: unknown }).target : undefined;
  if (Array.isArray(target)) return target.length === 1 && target[0] === "slug";
  return typeof target === "string" && /(^|_)slug(_key)?$/.test(target);
}

function generateShortId(): string {
  return randomBytes(4).toString("hex");
}

export function createVehicleService(input: {
  readonly repository: VehicleRepository;
  readonly shortId?: () => string;
  readonly now?: () => Date;
  readonly revalidateVehicle?: (slug: string) => void | Promise<void>;
  readonly reportCacheFailure?: (
    context: VehiclePublishContext,
  ) => void | Promise<void>;
}): VehicleService {
  const shortId = input.shortId ?? generateShortId;
  const now = input.now ?? (() => new Date());

  return {
    async create(actor, rawInput) {
      requireCapability(actor, "content:manage");
      const parsed = createVehicleSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid vehicle details.");

      const brand = await input.repository.findBrandById(parsed.data.brandId);
      const brandName = brand?.name.trim() ?? "";
      if (brand === null || brandName.length === 0) {
        throw new AppError({
          status: 422,
          code: "VEHICLE_BRAND_INVALID",
          message: "Select an available brand.",
        });
      }

      const saleStatus = parsed.data.isForSale ? parsed.data.saleStatus : null;
      const salePrice = parsed.data.isForSale
        ? toBigIntShillings(parsed.data.salePrice)
        : null;
      const description = parsed.data.description ?? null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const slug = createVehicleSlug({
          brand: brandName,
          model: parsed.data.model,
          year: parsed.data.year,
          shortId: shortId(),
        });
        try {
          const created = await input.repository.create({
            ...parsed.data,
            brandName,
            slug,
            saleStatus,
            salePrice,
            description,
          });
          return toVehicleAdminDTO(created);
        } catch (error) {
          if (!isSlugUniqueViolation(error)) throw error;
          if (attempt === 3) {
            throw new AppError({
              status: 409,
              code: "VEHICLE_SLUG_CONFLICT",
              message:
                "A unique vehicle address could not be created. Try again.",
            });
          }
        }
      }
      throw new Error("Unreachable vehicle slug retry state.");
    },

    async publish(actor, rawId, context) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawId);
      if (!id.success) throw validationError("Invalid vehicle ID.");
      const candidate = await input.repository.getPublicationCandidate(id.data);
      if (candidate === null) throw notFound();
      if (candidate.listingState === ListingState.published) {
        return toVehicleAdminDTO(candidate);
      }
      const missing = publicationRequirements(candidate);
      if (missing.length > 0) {
        throw new AppError({
          status: 422,
          code: "VEHICLE_NOT_READY",
          message: "The vehicle is not ready to publish.",
          details: { missing: [...missing] },
        });
      }
      const published = await input.repository.publish(id.data, now());
      if (input.revalidateVehicle !== undefined) {
        try {
          await input.revalidateVehicle(published.slug);
        } catch {
          if (context !== undefined && input.reportCacheFailure !== undefined) {
            try {
              await input.reportCacheFailure(context);
            } catch {}
          }
        }
      }
      return toVehicleAdminDTO(published);
    },

    async getPublicBySlug(rawSlug) {
      const slug = vehicleSlugSchema.safeParse(rawSlug);
      if (!slug.success) throw notFound();
      const vehicle = await input.repository.getPublicBySlug(slug.data);
      if (vehicle === null) throw notFound();
      return toVehiclePublicDetailDTO(vehicle);
    },

    async getAdminById(actor, rawId) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawId);
      if (!id.success) throw validationError("Invalid vehicle ID.");
      const vehicle = await input.repository.getAdminById(id.data);
      if (vehicle === null) throw notFound();
      return toVehicleAdminDTO(vehicle);
    },

    async listAdmin(actor, rawQuery) {
      requireCapability(actor, "content:manage");
      const query = vehicleListQuerySchema.safeParse(rawQuery);
      if (!query.success) throw validationError("Invalid vehicle query.");
      const page = await input.repository.listAdmin(query.data);
      return { ...page, items: page.items.map(toVehicleAdminDTO) };
    },

    async listBrands(actor) {
      requireCapability(actor, "content:manage");
      return input.repository.listBrands();
    },
  };
}
