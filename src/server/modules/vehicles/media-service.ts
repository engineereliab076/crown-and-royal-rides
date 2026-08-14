import "server-only";

import { AppError } from "@/server/http/errors";
import { IntegrationUnavailableError } from "@/server/integrations/errors";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type {
  UploadResult,
  UploadSignature,
  VerifiedAsset,
} from "@/server/integrations/media-storage/types";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import {
  toVehicleAdminDTO,
  type VehicleAdminDTO,
} from "@/server/modules/vehicles/dto";
import type { VehicleRepository } from "@/server/modules/vehicles/repository";
import {
  completedVehicleUploadSchema,
  vehicleIdSchema,
  type CompletedVehicleUpload,
} from "@/server/modules/vehicles/schemas";

const VEHICLE_FOLDER = "vehicles";

export interface VehicleMediaContext {
  readonly correlationId: string;
  readonly actorId: string;
}

export interface VehicleMediaService {
  createCoverUploadAuthorization(
    actor: AuthenticatedActor,
    vehicleId: string,
  ): Promise<UploadSignature>;
  attachCover(
    actor: AuthenticatedActor,
    vehicleId: string,
    completedUpload: CompletedVehicleUpload,
    context: VehicleMediaContext,
  ): Promise<VehicleAdminDTO>;
}

function requireVehicleMediaCapabilities(actor: AuthenticatedActor): void {
  // Both are deliberate: media permission alone must never grant mutation of a
  // vehicle the actor cannot otherwise manage.
  requireCapability(actor, "media:manage");
  requireCapability(actor, "content:manage");
}

function notFound(): AppError {
  return new AppError({
    status: 404,
    code: "VEHICLE_NOT_FOUND",
    message: "Vehicle not found.",
  });
}

function coverExists(): AppError {
  return new AppError({
    status: 409,
    code: "VEHICLE_COVER_EXISTS",
    message: "This vehicle already has a cover image.",
  });
}

function safeMediaError(error: unknown): AppError {
  if (error instanceof IntegrationUnavailableError) {
    return new AppError({
      status: 503,
      code: "MEDIA_UNAVAILABLE",
      message: "Image verification is temporarily unavailable. Try again.",
    });
  }
  return new AppError({
    status: 422,
    code: "MEDIA_VERIFICATION_FAILED",
    message: "The uploaded image could not be verified.",
  });
}

function mediaUnavailable(): AppError {
  return new AppError({
    status: 503,
    code: "MEDIA_UNAVAILABLE",
    message: "Image verification is temporarily unavailable. Try again.",
  });
}

function isDuplicateImageConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2002") return false;
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return true;
  const modelName =
    "modelName" in meta
      ? (meta as { modelName?: unknown }).modelName
      : undefined;
  return modelName === undefined || modelName === "VehicleImage";
}

function isMissingRecord(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

async function reportCleanupFailure(
  reporter: ErrorReporter,
  context: VehicleMediaContext,
): Promise<void> {
  try {
    await reporter.captureMessage(
      "Vehicle cover orphan cleanup failed.",
      "warning",
      {
        correlationId: context.correlationId,
        actorId: context.actorId,
        additional: { operation: "vehicle-cover-cleanup" },
      },
    );
  } catch {}
}

async function cleanupIfOrphaned(input: {
  repository: VehicleRepository;
  storage: MediaStorage;
  reporter: () => ErrorReporter;
  asset: VerifiedAsset;
  context: VehicleMediaContext;
}): Promise<void> {
  try {
    if (
      (await input.repository.findImageByPublicId(input.asset.publicId)) !==
      null
    ) {
      return;
    }
  } catch {
    // An inconclusive database check is not sufficient authority to delete.
    return;
  }
  const outcome = await input.storage.deleteAsset(input.asset.publicId);
  if (outcome.status === "failed") {
    await reportCleanupFailure(input.reporter(), input.context);
  }
}

export function createVehicleMediaService(input: {
  readonly repository: VehicleRepository;
  readonly mediaStorage: () => MediaStorage;
  readonly errorReporter: () => ErrorReporter;
}): VehicleMediaService {
  return {
    async createCoverUploadAuthorization(actor, rawVehicleId) {
      requireVehicleMediaCapabilities(actor);
      const id = vehicleIdSchema.safeParse(rawVehicleId);
      if (!id.success) {
        throw new AppError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Invalid vehicle ID.",
        });
      }
      const vehicle = await input.repository.getAdminById(id.data);
      if (vehicle === null) throw notFound();
      if (vehicle.images.some((image) => image.isCover)) throw coverExists();
      try {
        return await input.mediaStorage().createUploadSignature({
          folder: VEHICLE_FOLDER,
          ownerType: "vehicle",
          ownerId: id.data,
        });
      } catch {
        throw mediaUnavailable();
      }
    },

    async attachCover(actor, rawVehicleId, rawUpload, context) {
      requireVehicleMediaCapabilities(actor);
      const id = vehicleIdSchema.safeParse(rawVehicleId);
      const upload = completedVehicleUploadSchema.safeParse(rawUpload);
      if (!id.success || !upload.success) {
        throw new AppError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Invalid cover attachment.",
        });
      }

      let storage: MediaStorage;
      try {
        storage = input.mediaStorage();
      } catch {
        throw mediaUnavailable();
      }
      let asset: VerifiedAsset;
      try {
        asset = await storage.verifyUploadResult(upload.data as UploadResult);
      } catch (error) {
        throw safeMediaError(error);
      }

      const expectedPrefix = `vehicles/vehicle/${id.data}/`;
      const pathSegments = asset.publicId.split("/");
      const prefixIndex = pathSegments.findIndex(
        (segment) => segment === "vehicles",
      );
      if (
        prefixIndex < 0 ||
        pathSegments.slice(prefixIndex).join("/").startsWith(expectedPrefix) ===
          false
      ) {
        await cleanupIfOrphaned({
          repository: input.repository,
          storage,
          reporter: input.errorReporter,
          asset,
          context,
        });
        throw safeMediaError(new TypeError("Unexpected media namespace."));
      }

      const vehicle = await input.repository.getAdminById(id.data);
      if (vehicle === null || vehicle.images.some((image) => image.isCover)) {
        await cleanupIfOrphaned({
          repository: input.repository,
          storage,
          reporter: input.errorReporter,
          asset,
          context,
        });
        if (vehicle === null) throw notFound();
        throw coverExists();
      }

      try {
        return toVehicleAdminDTO(
          await input.repository.createCover(id.data, {
            publicId: asset.publicId,
            secureUrl: asset.url,
            width: asset.width,
            height: asset.height,
            format: asset.format,
            byteSize: asset.bytes,
            altText: `${vehicle.brandName} ${vehicle.model} cover image`,
          }),
        );
      } catch (error) {
        await cleanupIfOrphaned({
          repository: input.repository,
          storage,
          reporter: input.errorReporter,
          asset,
          context,
        });
        if (isDuplicateImageConflict(error)) throw coverExists();
        if (isMissingRecord(error)) throw notFound();
        throw new AppError({
          status: 500,
          code: "VEHICLE_COVER_ATTACH_FAILED",
          message: "The cover image could not be attached.",
        });
      }
    },
  };
}
