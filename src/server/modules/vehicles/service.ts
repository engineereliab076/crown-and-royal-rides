import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { ListingState } from "@/generated/prisma/enums";
import { toBigIntShillings } from "@/lib/money";
import { createVehicleSlug } from "@/lib/slug";
import { AppError } from "@/server/http/errors";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import {
  getPublicationReadiness,
  toVehicleAdminDTO,
  toVehicleCardDTO,
  toVehiclePublicDetailDTO,
  type VehicleAdminDTO,
  type VehicleCardDTO,
  type VehiclePublicDetailDTO,
} from "@/server/modules/vehicles/dto";
import type {
  VehicleBrandRecord,
  VehicleRepository,
} from "@/server/modules/vehicles/repository";
import {
  createVehicleSchema,
  featureVehicleSchema,
  vehicleIdSchema,
  vehicleListQuerySchema,
  vehicleSlugSchema,
  vehicleStepUpdateSchema,
  vehicleTransitionSchema,
  type CreateVehicleInput,
  type VehicleListInput,
  type VehicleStepUpdateInput,
  type VehicleTransitionInput,
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
export interface VehicleTransactionRepositories {
  readonly vehicles: VehicleRepository;
}
export type VehicleTransactionRunner = <T>(
  operation: (repositories: VehicleTransactionRepositories) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
) => Promise<T>;

export interface VehicleService {
  create(
    actor: AuthenticatedActor,
    input: CreateVehicleInput,
  ): Promise<VehicleAdminDTO>;
  updateDraft(
    actor: AuthenticatedActor,
    vehicleId: string,
    input: VehicleStepUpdateInput,
  ): Promise<VehicleAdminDTO>;
  transitionVehicle(
    actor: AuthenticatedActor,
    input: VehicleTransitionInput,
    context?: VehiclePublishContext,
  ): Promise<VehicleAdminDTO>;
  publish(
    actor: AuthenticatedActor,
    vehicleId: string,
    context?: VehiclePublishContext,
  ): Promise<VehicleAdminDTO>;
  setFeatured(
    actor: AuthenticatedActor,
    input: { vehicleId: string; featured: boolean },
  ): Promise<VehicleAdminDTO>;
  listFeaturedPublic(): Promise<readonly VehicleCardDTO[]>;
  markVerified(
    actor: AuthenticatedActor,
    input: { vehicleId: string },
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
function invalidTransition(): AppError {
  return new AppError({
    status: 409,
    code: "INVALID_VEHICLE_TRANSITION",
    message: "That vehicle transition is not allowed.",
  });
}
function isDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
function isRetryableConflict(error: unknown): boolean {
  if (isDatabaseCode(error, "P2034")) return true;
  if (!isDatabaseCode(error, "P2010")) return false;
  const meta = (
    error as {
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    }
  ).meta;
  const code = meta?.driverAdapterError?.cause?.originalCode;
  return code === "40001" || code === "40P01";
}
function isSlugUniqueViolation(error: unknown): boolean {
  if (!isDatabaseCode(error, "P2002")) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target)
    ? target.length === 1 && target[0] === "slug"
    : typeof target === "string" && /slug/.test(target);
}
function isIdentifierUniqueViolation(error: unknown): boolean {
  if (!isDatabaseCode(error, "P2002")) return false;
  const target = JSON.stringify((error as { meta?: unknown }).meta ?? {});
  return /registration|chassis/i.test(target);
}
function generateShortId(): string {
  return randomBytes(4).toString("hex");
}

/** Publicly rendered specification fields (registration/chassis are private). */
const SPECIFICATION_PUBLIC_KEYS = [
  "mileageKm",
  "engineCc",
  "engineDescription",
  "seats",
  "doors",
  "exteriorColor",
  "interiorColor",
  "drivetrain",
] as const;

/**
 * True when a specifications update changes at least one publicly rendered
 * field relative to the current record. A field absent from the payload, or
 * present with an unchanged value, is not a change — so an edit that only sets
 * the private registration/chassis numbers returns false.
 */
function specificationsPublicChange(
  next: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return SPECIFICATION_PUBLIC_KEYS.some(
    (key) => next[key] !== undefined && next[key] !== current[key],
  );
}

async function serializable<T>(
  transaction: VehicleTransactionRunner,
  operation: (repositories: VehicleTransactionRepositories) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isRetryableConflict(error) || attempt === 3) {
        if (isRetryableConflict(error))
          throw new AppError({
            status: 409,
            code: "CONCURRENT_VEHICLE_UPDATE",
            message: "The vehicle changed concurrently. Try again.",
          });
        throw error;
      }
    }
  }
  throw new Error("Unreachable serializable retry state.");
}

export function createVehicleService(input: {
  readonly repository: VehicleRepository;
  readonly transaction?: VehicleTransactionRunner;
  readonly shortId?: () => string;
  readonly now?: () => Date;
  readonly revalidateVehicle?: (slug: string) => void | Promise<void>;
  readonly reportCacheFailure?: (
    context: VehiclePublishContext,
  ) => void | Promise<void>;
}): VehicleService {
  const shortId = input.shortId ?? generateShortId;
  const now = input.now ?? (() => new Date());
  const transaction: VehicleTransactionRunner =
    input.transaction ??
    (async (operation) => operation({ vehicles: input.repository }));

  async function revalidateAfterCommit(
    slug: string,
    context?: VehiclePublishContext,
  ): Promise<void> {
    if (input.revalidateVehicle === undefined) return;
    try {
      await input.revalidateVehicle(slug);
    } catch {
      if (context !== undefined && input.reportCacheFailure !== undefined) {
        try {
          await input.reportCacheFailure(context);
        } catch {}
      }
    }
  }

  return {
    async create(actor, rawInput) {
      requireCapability(actor, "content:manage");
      const parsed = createVehicleSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid vehicle details.");
      const brand = await input.repository.findBrandById(parsed.data.brandId);
      const brandName = brand?.name.trim() ?? "";
      if (brand === null || brandName.length === 0)
        throw new AppError({
          status: 422,
          code: "VEHICLE_BRAND_INVALID",
          message: "Select an available brand.",
        });

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const slug = createVehicleSlug({
          brand: brandName,
          model: parsed.data.model,
          year: parsed.data.year,
          shortId: shortId(),
        });
        try {
          const created = await input.repository.create({
            brandId: parsed.data.brandId,
            brandName,
            model: parsed.data.model,
            slug,
            year: parsed.data.year,
            bodyType: parsed.data.bodyType,
            condition: parsed.data.condition,
            transmission: parsed.data.transmission,
            fuelType: parsed.data.fuelType,
            driverOption: parsed.data.driverOption,
            isForSale: parsed.data.isForSale,
            saleStatus: parsed.data.isForSale
              ? (parsed.data.saleStatus ?? null)
              : null,
            salePrice:
              parsed.data.isForSale && parsed.data.salePrice != null
                ? toBigIntShillings(parsed.data.salePrice)
                : null,
            isForRent: parsed.data.isForRent,
            rentalStatus: parsed.data.isForRent
              ? (parsed.data.rentalStatus ?? null)
              : null,
            rentalDailyPrice:
              parsed.data.isForRent && parsed.data.rentalDailyPrice != null
                ? toBigIntShillings(parsed.data.rentalDailyPrice)
                : null,
            minRentalDays: parsed.data.isForRent
              ? (parsed.data.minRentalDays ?? null)
              : null,
            isNegotiable: parsed.data.isNegotiable ?? false,
            // Private identifiers are owned solely by the Step 4 specifications
            // update schema; creation never accepts them (repository defaults
            // both to null).
            location: parsed.data.location ?? null,
            driverNote: parsed.data.driverNote ?? null,
            mileageKm: parsed.data.mileageKm ?? null,
            engineCc: parsed.data.engineCc ?? null,
            engineDescription: parsed.data.engineDescription ?? null,
            seats: parsed.data.seats ?? null,
            doors: parsed.data.doors ?? null,
            exteriorColor: parsed.data.exteriorColor ?? null,
            interiorColor: parsed.data.interiorColor ?? null,
            drivetrain: parsed.data.drivetrain ?? null,
            features: parsed.data.features ?? [],
            description: parsed.data.description ?? null,
          });
          return toVehicleAdminDTO(created);
        } catch (error) {
          if (isIdentifierUniqueViolation(error))
            throw new AppError({
              status: 409,
              code: "VEHICLE_IDENTIFIER_EXISTS",
              message: "That registration or chassis number is already in use.",
            });
          if (!isSlugUniqueViolation(error)) throw error;
          if (attempt === 3)
            throw new AppError({
              status: 409,
              code: "VEHICLE_SLUG_CONFLICT",
              message:
                "A unique vehicle address could not be created. Try again.",
            });
        }
      }
      throw new Error("Unreachable vehicle slug retry state.");
    },

    async updateDraft(actor, rawId, rawInput) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawId);
      const parsed = vehicleStepUpdateSchema.safeParse(rawInput);
      if (!id.success || !parsed.success)
        throw validationError("Invalid vehicle draft update.");
      let publicChanged = false;
      try {
        const updated = await transaction(async ({ vehicles }) => {
          const current = await vehicles.getAdminById(id.data);
          if (current === null) throw notFound();
          const published = current.listingState === ListingState.published;
          let data: Prisma.VehicleUncheckedUpdateInput;
          switch (parsed.data.step) {
            case "basics": {
              const next = parsed.data.data;
              let brandName: string | undefined;
              if (next.brandId !== undefined) {
                const brand = await vehicles.findBrandById(next.brandId);
                if (brand === null)
                  throw new AppError({
                    status: 422,
                    code: "VEHICLE_BRAND_INVALID",
                    message: "Select an available brand.",
                  });
                brandName = brand.name.trim();
              }
              data = {
                ...next,
                ...(brandName === undefined ? {} : { brandName }),
              };
              // Every basics field is publicly rendered.
              publicChanged = published;
              break;
            }
            case "modes-and-pricing": {
              const next = parsed.data.data;
              data = {
                isForSale: next.isForSale,
                saleStatus: next.saleStatus,
                salePrice:
                  next.salePrice === null
                    ? null
                    : toBigIntShillings(next.salePrice),
                isNegotiable: next.isNegotiable,
                isForRent: next.isForRent,
                rentalStatus: next.rentalStatus,
                rentalDailyPrice:
                  next.rentalDailyPrice === null
                    ? null
                    : toBigIntShillings(next.rentalDailyPrice),
                minRentalDays: next.minRentalDays,
              };
              publicChanged = published;
              break;
            }
            case "specifications": {
              const next = parsed.data.data;
              data = { ...next };
              // Registration/chassis are private-only; a specifications edit
              // revalidates only when a publicly rendered field actually
              // changes, so a private-only edit never revalidates.
              publicChanged =
                published && specificationsPublicChange(next, current);
              break;
            }
            default:
              data = { ...parsed.data.data };
              publicChanged = published;
          }
          return vehicles.updateDraft(id.data, data);
        });
        if (publicChanged) await revalidateAfterCommit(updated.slug);
        return toVehicleAdminDTO(updated);
      } catch (error) {
        if (isIdentifierUniqueViolation(error))
          throw new AppError({
            status: 409,
            code: "VEHICLE_IDENTIFIER_EXISTS",
            message: "That registration or chassis number is already in use.",
          });
        throw error;
      }
    },

    async transitionVehicle(actor, rawInput, context) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawInput.vehicleId);
      const action = vehicleTransitionSchema.safeParse({
        action: rawInput.action,
      });
      if (!id.success || !action.success)
        throw validationError("Invalid vehicle transition.");
      let publicChanged = false;
      const updated = await transaction(async ({ vehicles }) => {
        if (!(await vehicles.lockVehicle(id.data))) throw notFound();
        const current = await vehicles.getPublicationCandidate(id.data);
        if (current === null) throw notFound();
        switch (action.data.action) {
          case "publish": {
            if (current.listingState === ListingState.published) return current;
            if (current.listingState !== ListingState.draft)
              throw invalidTransition();
            const readiness = getPublicationReadiness(current);
            if (!readiness.ready)
              throw new AppError({
                status: 422,
                code: "VEHICLE_NOT_READY",
                message: "The vehicle is not ready to publish.",
                details: { missing: [...readiness.missing] },
              });
            publicChanged = true;
            return vehicles.publish(id.data, now());
          }
          case "unpublish":
            if (current.listingState === ListingState.draft) return current;
            if (current.listingState !== ListingState.published)
              throw invalidTransition();
            publicChanged = true;
            return vehicles.updateListingState(id.data, {
              listingState: "draft",
              publishedAt: null,
              isFeatured: false,
              featuredAt: null,
            });
          case "archive":
            if (current.listingState === ListingState.archived) return current;
            publicChanged = current.listingState === ListingState.published;
            return vehicles.updateListingState(id.data, {
              listingState: "archived",
              publishedAt: null,
              isFeatured: false,
              featuredAt: null,
            });
          case "restore":
            if (current.listingState === ListingState.draft) return current;
            if (current.listingState !== ListingState.archived)
              throw invalidTransition();
            // The archived vehicle was publicly resolvable as a retired detail
            // page; restoring to draft must purge that cached page.
            publicChanged = true;
            return vehicles.updateListingState(id.data, {
              listingState: "draft",
              publishedAt: null,
              isFeatured: false,
              featuredAt: null,
            });
          case "sale_available":
          case "sale_reserved":
          case "sale_sold": {
            if (!current.isForSale) throw invalidTransition();
            const status = action.data.action.replace("sale_", "") as
              "available" | "reserved" | "sold";
            if (current.saleStatus === status) return current;
            publicChanged = current.listingState === ListingState.published;
            return vehicles.updateSaleStatus(id.data, status);
          }
          case "rental_available":
          case "rental_reserved":
          case "rental_rented":
          case "rental_unavailable": {
            if (!current.isForRent) throw invalidTransition();
            const status = action.data.action.replace("rental_", "") as
              "available" | "reserved" | "rented" | "unavailable";
            if (current.rentalStatus === status) return current;
            publicChanged = current.listingState === ListingState.published;
            return vehicles.updateRentalStatus(id.data, status);
          }
        }
      });
      if (publicChanged) await revalidateAfterCommit(updated.slug, context);
      return toVehicleAdminDTO(updated);
    },

    async publish(actor, vehicleId, context) {
      return this.transitionVehicle(
        actor,
        { vehicleId, action: "publish" },
        context,
      );
    },

    async setFeatured(actor, rawInput) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawInput.vehicleId);
      const desired = featureVehicleSchema.safeParse({
        featured: rawInput.featured,
      });
      if (!id.success || !desired.success)
        throw validationError("Invalid featured request.");
      let changed = false;
      const updated = await serializable(transaction, async ({ vehicles }) => {
        await vehicles.lockFeaturedSet();
        if (!(await vehicles.lockVehicle(id.data))) throw notFound();
        const current = await vehicles.getAdminById(id.data);
        if (current === null) throw notFound();
        if (current.isFeatured === desired.data.featured) return current;
        if (!desired.data.featured) {
          changed = true;
          return vehicles.setFeatured(id.data, null);
        }
        if (
          current.listingState !== ListingState.published ||
          !getPublicationReadiness(current).ready
        ) {
          throw new AppError({
            status: 422,
            code: "VEHICLE_NOT_READY",
            message:
              "Only a publication-ready published vehicle can be featured.",
          });
        }
        if ((await vehicles.countFeatured()) >= 8)
          throw new AppError({
            status: 422,
            code: "FEATURED_LIMIT_REACHED",
            message: "No more than eight vehicles can be featured.",
          });
        changed = true;
        return vehicles.setFeatured(id.data, now());
      });
      if (changed) await revalidateAfterCommit(updated.slug);
      return toVehicleAdminDTO(updated);
    },

    async listFeaturedPublic() {
      return (await input.repository.listFeaturedPublic()).map(
        toVehicleCardDTO,
      );
    },
    async markVerified(actor, rawInput) {
      requireCapability(actor, "content:manage");
      const id = vehicleIdSchema.safeParse(rawInput.vehicleId);
      if (!id.success) throw validationError("Invalid vehicle ID.");
      if ((await input.repository.getAdminById(id.data)) === null)
        throw notFound();
      return toVehicleAdminDTO(
        await input.repository.markVerified(id.data, now()),
      );
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
