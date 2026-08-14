import "server-only";

import { randomUUID } from "node:crypto";

import { AppError, isAppError } from "@/server/http/errors";
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
import type { MediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";
import {
  toVehicleImageDTO,
  toVehicleImageDTOList,
  type VehicleGalleryDTO,
  type VehicleImageDTO,
} from "@/server/modules/vehicle-images/dto";
import type { VehicleImageRepository } from "@/server/modules/vehicle-images/repository";
import {
  attachVehicleImageSchema,
  listVehicleImagesSchema,
  MAX_VEHICLE_IMAGES,
  removeVehicleImageSchema,
  reorderVehicleImagesSchema,
  setVehicleCoverSchema,
  updateVehicleImageAltTextSchema,
  uploadAuthorizationRequestSchema,
} from "@/server/modules/vehicle-images/schemas";

/** The controlled top-level media folder shared with the Phase 3 cover flow. */
const VEHICLE_FOLDER = "vehicles";
const DELETION_OWNER_TYPE = "vehicle" as const;

/** Optional per-request context used only for internal, redacted reporting. */
export interface VehicleImageContext {
  readonly correlationId?: string;
}

export interface VehicleImageTransactionRepositories {
  readonly images: VehicleImageRepository;
  readonly deletionQueue: MediaDeletionQueueRepository;
}

export type VehicleImageTransaction = <T>(
  operation: (repos: VehicleImageTransactionRepositories) => Promise<T>,
) => Promise<T>;

export interface VehicleImageServiceDependencies {
  /** Base-client repository for read-only listing and orphan probing. */
  readonly repository: VehicleImageRepository;
  /** Base-client deletion queue for post-commit resolve/failure recording. */
  readonly deletionQueue: MediaDeletionQueueRepository;
  /** Runs an operation inside a single interactive transaction. */
  readonly transaction: VehicleImageTransaction;
  readonly mediaStorage: () => MediaStorage;
  readonly errorReporter: () => ErrorReporter;
  /**
   * Revalidate a published vehicle's public cache after its gallery changed.
   * Invoked only after the database commit, only for published vehicles, and
   * only for changes that alter the public representation. Optional.
   */
  readonly revalidate?: (slug: string) => void | Promise<void>;
}

/**
 * The service is the authoritative validation boundary: every operation strictly
 * parses its raw input with Zod, so callers (route handlers) pass runtime-unknown
 * data and rely on the service to reject unknown/server-controlled fields.
 */
export interface VehicleImageService {
  /** List a vehicle's gallery plus its parent `updatedAt` for concurrency. */
  getGallery(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<VehicleGalleryDTO>;
  /** Issue a fresh signed upload authorization for a vehicle's gallery. */
  createUploadAuthorization(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<UploadSignature>;
  listForVehicle(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<readonly VehicleImageDTO[]>;
  attach(
    actor: AuthenticatedActor,
    input: unknown,
    context?: VehicleImageContext,
  ): Promise<VehicleImageDTO>;
  reorder(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<VehicleGalleryDTO>;
  setCover(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<VehicleGalleryDTO>;
  updateAltText(
    actor: AuthenticatedActor,
    input: unknown,
  ): Promise<VehicleImageDTO>;
  remove(
    actor: AuthenticatedActor,
    input: unknown,
    context?: VehicleImageContext,
  ): Promise<VehicleGalleryDTO>;
}

// ── Safe, stable errors (never leak SQL, provider text, URLs or public IDs) ───

function validationError(message: string): AppError {
  return new AppError({ status: 422, code: "VALIDATION_ERROR", message });
}

function vehicleNotFound(): AppError {
  return new AppError({
    status: 404,
    code: "VEHICLE_NOT_FOUND",
    message: "Vehicle not found.",
  });
}

function imageNotFound(): AppError {
  // Deliberately identical for a missing image and one that belongs to another
  // vehicle: revealing the difference would disclose gallery membership.
  return new AppError({
    status: 404,
    code: "VEHICLE_IMAGE_NOT_FOUND",
    message: "Image not found.",
  });
}

function imageLimitReached(): AppError {
  return new AppError({
    status: 422,
    code: "VEHICLE_IMAGE_LIMIT_REACHED",
    message: `A vehicle may have at most ${MAX_VEHICLE_IMAGES} images.`,
  });
}

function duplicateImage(): AppError {
  return new AppError({
    status: 409,
    code: "VEHICLE_IMAGE_DUPLICATE",
    message: "This image has already been added to the vehicle.",
  });
}

function staleRecord(): AppError {
  return new AppError({
    status: 409,
    code: "STALE_RECORD",
    message: "The vehicle changed since it was loaded. Reload and try again.",
  });
}

function incompleteSet(): AppError {
  return new AppError({
    status: 422,
    code: "VEHICLE_IMAGE_SET_MISMATCH",
    message: "The submitted order must list every current image exactly once.",
  });
}

function operationFailed(): AppError {
  return new AppError({
    status: 500,
    code: "VEHICLE_IMAGE_OPERATION_FAILED",
    message: "The gallery change could not be completed.",
  });
}

function verificationError(error: unknown): AppError {
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

function requireReadCapability(actor: AuthenticatedActor): void {
  requireCapability(actor, "media:manage");
}

function requireMutationCapabilities(actor: AuthenticatedActor): void {
  // media:manage alone must never grant mutation of a vehicle the actor cannot
  // otherwise manage — both capabilities are required (the Phase 3 rule).
  requireCapability(actor, "media:manage");
  requireCapability(actor, "content:manage");
}

/**
 * The verified asset must live under this vehicle's exact controlled namespace
 * (`…/vehicles/vehicle/{vehicleId}/…`). Anything else is rejected before any
 * persistence. Mirrors the Phase 3 cover check so both flows agree.
 */
function isWithinVehicleNamespace(
  publicId: string,
  vehicleId: string,
): boolean {
  const expectedPrefix = `${VEHICLE_FOLDER}/vehicle/${vehicleId}/`;
  const segments = publicId.split("/");
  const rootIndex = segments.findIndex((segment) => segment === VEHICLE_FOLDER);
  return (
    rootIndex >= 0 &&
    segments.slice(rootIndex).join("/").startsWith(expectedPrefix)
  );
}

export function createVehicleImageService(
  deps: VehicleImageServiceDependencies,
): VehicleImageService {
  async function reportRedacted(
    message: string,
    context: VehicleImageContext | undefined,
    actor: AuthenticatedActor,
    operation: string,
  ): Promise<void> {
    try {
      await deps.errorReporter().captureMessage(message, "warning", {
        correlationId: context?.correlationId ?? randomUUID(),
        actorId: actor.id,
        additional: { operation },
      });
    } catch {
      // Reporting must never replace or mask the original outcome.
    }
  }

  /**
   * Delete a verified asset only when the database proves it is unattached. An
   * inconclusive database read is never sufficient authority to delete, and a
   * cleanup failure is reported (redacted) but never replaces the caller's
   * original error.
   */
  async function cleanupIfOrphaned(
    asset: VerifiedAsset,
    context: VehicleImageContext | undefined,
    actor: AuthenticatedActor,
  ): Promise<void> {
    try {
      if (
        (await deps.repository.findImageByPublicId(asset.publicId)) !== null
      ) {
        return;
      }
    } catch {
      return;
    }
    try {
      const outcome = await deps.mediaStorage().deleteAsset(asset.publicId);
      if (outcome.status === "failed") {
        await reportRedacted(
          "Vehicle image orphan cleanup failed.",
          context,
          actor,
          "vehicle-image-cleanup",
        );
      }
    } catch {
      await reportRedacted(
        "Vehicle image orphan cleanup failed.",
        context,
        actor,
        "vehicle-image-cleanup",
      );
    }
  }

  /**
   * Attempt the durable provider deletion after the database mutation commits.
   * On success the queue row is resolved; on failure or timeout the row remains
   * for a later retry and only a generic marker is recorded — no provider error
   * or public ID is ever logged or surfaced.
   */
  async function completeProviderDeletion(
    publicId: string,
    queueId: bigint,
  ): Promise<void> {
    let outcome;
    try {
      outcome = await deps.mediaStorage().deleteAsset(publicId);
    } catch {
      try {
        await deps.deletionQueue.recordFailure(queueId, new Date());
      } catch {}
      return;
    }
    if (outcome.status === "deleted" || outcome.status === "alreadyMissing") {
      try {
        await deps.deletionQueue.resolve(queueId);
      } catch {}
      return;
    }
    try {
      await deps.deletionQueue.recordFailure(queueId, new Date());
    } catch {}
  }

  function guard(error: unknown): never {
    if (isAppError(error)) throw error;
    throw operationFailed();
  }

  /**
   * Revalidate the published public cache after a committed gallery change.
   * Only published vehicles need it; the mutation is never rolled back if the
   * cache call fails, and the failure is reported with no public ID or URL.
   */
  async function revalidateIfPublished(
    vehicle: { readonly slug: string; readonly listingState: string },
    context: VehicleImageContext | undefined,
    actor: AuthenticatedActor,
  ): Promise<void> {
    if (deps.revalidate === undefined || vehicle.listingState !== "published") {
      return;
    }
    try {
      await deps.revalidate(vehicle.slug);
    } catch {
      await reportRedacted(
        "Vehicle gallery cache revalidation failed.",
        context,
        actor,
        "vehicle-image-revalidate",
      );
    }
  }

  return {
    async getGallery(actor, rawInput) {
      requireReadCapability(actor);
      const parsed = listVehicleImagesSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid vehicle ID.");
      const vehicle = await deps.repository.findVehicleTimestamp(
        parsed.data.vehicleId,
      );
      if (vehicle === null) throw vehicleNotFound();
      const images = await deps.repository.listImages(parsed.data.vehicleId);
      return {
        images: toVehicleImageDTOList(images),
        updatedAt: vehicle.updatedAt.toISOString(),
      };
    },

    async createUploadAuthorization(actor, rawInput) {
      requireMutationCapabilities(actor);
      const parsed = uploadAuthorizationRequestSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid vehicle ID.");
      const vehicle = await deps.repository.findVehicleTimestamp(
        parsed.data.vehicleId,
      );
      if (vehicle === null) throw vehicleNotFound();
      // A pre-upload gate: never authorize an upload for a full gallery. The
      // authoritative limit is still enforced inside the attach transaction.
      const count = await deps.repository.countImages(parsed.data.vehicleId);
      if (count >= MAX_VEHICLE_IMAGES) throw imageLimitReached();
      try {
        return await deps.mediaStorage().createUploadSignature({
          folder: VEHICLE_FOLDER,
          ownerType: "vehicle",
          ownerId: parsed.data.vehicleId,
        });
      } catch {
        throw mediaUnavailable();
      }
    },

    async listForVehicle(actor, rawInput) {
      requireReadCapability(actor);
      const parsed = listVehicleImagesSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid vehicle ID.");
      const vehicle = await deps.repository.findVehicleTimestamp(
        parsed.data.vehicleId,
      );
      if (vehicle === null) throw vehicleNotFound();
      const images = await deps.repository.listImages(parsed.data.vehicleId);
      return toVehicleImageDTOList(images);
    },

    async attach(actor, rawInput, context) {
      requireMutationCapabilities(actor);
      const parsed = attachVehicleImageSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid image attachment.");
      const { vehicleId, altText } = parsed.data;

      let storage: MediaStorage;
      try {
        storage = deps.mediaStorage();
      } catch {
        throw mediaUnavailable();
      }

      let asset: VerifiedAsset;
      try {
        asset = await storage.verifyUploadResult(
          parsed.data.upload as UploadResult,
        );
      } catch (error) {
        throw verificationError(error);
      }

      if (!isWithinVehicleNamespace(asset.publicId, vehicleId)) {
        await cleanupIfOrphaned(asset, context, actor);
        throw verificationError(new TypeError("Unexpected media namespace."));
      }

      try {
        const committed = await deps.transaction(async ({ images }) => {
          const vehicle = await images.lockVehicle(vehicleId);
          if (vehicle === null) throw vehicleNotFound();
          const count = await images.countImages(vehicleId);
          if (count >= MAX_VEHICLE_IMAGES) throw imageLimitReached();
          if ((await images.findImageByPublicId(asset.publicId)) !== null) {
            throw duplicateImage();
          }
          const record = await images.createImage({
            vehicleId,
            publicId: asset.publicId,
            secureUrl: asset.url,
            width: asset.width,
            height: asset.height,
            format: asset.format,
            byteSize: asset.bytes,
            altText,
            // Append at the end; the first image of an empty gallery is cover.
            sortOrder: count,
            isCover: count === 0,
          });
          await images.touchVehicle(vehicleId);
          return { record, vehicle };
        });
        await revalidateIfPublished(committed.vehicle, context, actor);
        return toVehicleImageDTO(committed.record);
      } catch (error) {
        // The upload may be orphaned by a rolled-back transaction; clean it up
        // only if the database proves it unattached, then surface a safe error.
        await cleanupIfOrphaned(asset, context, actor);
        guard(error);
      }
    },

    async reorder(actor, rawInput) {
      requireMutationCapabilities(actor);
      const parsed = reorderVehicleImagesSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid reorder request.");
      const { vehicleId, imageIds, expectedUpdatedAt } = parsed.data;
      const expectedMs = Date.parse(expectedUpdatedAt);

      try {
        const result = await deps.transaction(async ({ images }) => {
          const vehicle = await images.lockVehicle(vehicleId);
          if (vehicle === null) throw vehicleNotFound();
          if (vehicle.updatedAt.getTime() !== expectedMs) throw staleRecord();

          const current = await images.listImages(vehicleId);
          const currentIds = new Set(current.map((image) => image.id));
          const sameSet =
            currentIds.size === imageIds.length &&
            imageIds.every((id) => currentIds.has(id));
          if (!sameSet) throw incompleteSet();

          await images.replaceSortOrders(
            imageIds.map((id, index) => ({ id, sortOrder: index })),
          );
          const updatedAt = await images.touchVehicle(vehicleId);
          const reordered = await images.listImages(vehicleId);
          return { images: reordered, updatedAt, vehicle };
        });
        await revalidateIfPublished(result.vehicle, undefined, actor);
        return {
          images: toVehicleImageDTOList(result.images),
          updatedAt: result.updatedAt.toISOString(),
        };
      } catch (error) {
        guard(error);
      }
    },

    async setCover(actor, rawInput) {
      requireMutationCapabilities(actor);
      const parsed = setVehicleCoverSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid cover request.");
      const { vehicleId, imageId, expectedUpdatedAt } = parsed.data;
      const expectedMs = Date.parse(expectedUpdatedAt);

      try {
        const result = await deps.transaction(async ({ images }) => {
          const vehicle = await images.lockVehicle(vehicleId);
          if (vehicle === null) throw vehicleNotFound();
          if (vehicle.updatedAt.getTime() !== expectedMs) throw staleRecord();

          const current = await images.listImages(vehicleId);
          const target = current.find((image) => image.id === imageId);
          if (target === undefined) throw imageNotFound();

          // No-op when the selection is already the cover: no writes, no bump.
          if (target.isCover) {
            return {
              images: current,
              updatedAt: vehicle.updatedAt,
              changed: false,
              vehicle,
            };
          }

          await images.clearCover(vehicleId);
          await images.setCover(imageId);
          const updatedAt = await images.touchVehicle(vehicleId);
          const refreshed = await images.listImages(vehicleId);
          return { images: refreshed, updatedAt, changed: true, vehicle };
        });
        if (result.changed) {
          await revalidateIfPublished(result.vehicle, undefined, actor);
        }
        return {
          images: toVehicleImageDTOList(result.images),
          updatedAt: result.updatedAt.toISOString(),
        };
      } catch (error) {
        guard(error);
      }
    },

    async updateAltText(actor, rawInput) {
      requireMutationCapabilities(actor);
      const parsed = updateVehicleImageAltTextSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid alternative text.");
      const { vehicleId, imageId, altText } = parsed.data;

      try {
        const updated = await deps.transaction(async ({ images }) => {
          const vehicle = await images.lockVehicle(vehicleId);
          if (vehicle === null) throw vehicleNotFound();
          const current = await images.listImages(vehicleId);
          const target = current.find((image) => image.id === imageId);
          if (target === undefined) throw imageNotFound();
          const record = await images.updateAltText(imageId, altText);
          await images.touchVehicle(vehicleId);
          return { record, vehicle };
        });
        await revalidateIfPublished(updated.vehicle, undefined, actor);
        return toVehicleImageDTO(updated.record);
      } catch (error) {
        guard(error);
      }
    },

    async remove(actor, rawInput, context) {
      requireMutationCapabilities(actor);
      const parsed = removeVehicleImageSchema.safeParse(rawInput);
      if (!parsed.success) throw validationError("Invalid removal request.");
      const { vehicleId, imageId } = parsed.data;

      try {
        const committed = await deps.transaction(
          async ({ images, deletionQueue }) => {
            const vehicle = await images.lockVehicle(vehicleId);
            if (vehicle === null) throw vehicleNotFound();
            const current = await images.listImages(vehicleId);
            const target = current.find((image) => image.id === imageId);
            if (target === undefined) throw imageNotFound();

            await images.deleteImage(imageId);
            const remaining = current.filter((image) => image.id !== imageId);

            // If the cover was removed, promote the remaining image with the
            // smallest prior sort order (remaining is already sort_order ASC).
            const promote = remaining[0];
            if (target.isCover && promote !== undefined) {
              await images.setCover(promote.id);
            }
            // Compact remaining sort orders to 0..n-1.
            await images.replaceSortOrders(
              remaining.map((image, index) => ({
                id: image.id,
                sortOrder: index,
              })),
            );
            const updatedAt = await images.touchVehicle(vehicleId);
            // Outbox: record the durable deletion intent in the same
            // transaction that removed the row, before any provider call.
            const queued = await deletionQueue.enqueue({
              publicId: target.publicId,
              ownerType: DELETION_OWNER_TYPE,
            });
            const refreshed = await images.listImages(vehicleId);
            return {
              publicId: target.publicId,
              queueId: queued.id,
              images: refreshed,
              updatedAt,
              vehicle,
            };
          },
        );

        // Provider deletion happens only after the database mutation commits;
        // completeProviderDeletion swallows its own errors so a provider failure
        // never rolls back the committed removal.
        await completeProviderDeletion(committed.publicId, committed.queueId);
        await revalidateIfPublished(committed.vehicle, context, actor);
        return {
          images: toVehicleImageDTOList(committed.images),
          updatedAt: committed.updatedAt.toISOString(),
        };
      } catch (error) {
        guard(error);
      }
    },
  };
}
