import { z } from "zod";

/**
 * Strict Zod schemas for the vehicle-image gallery surface (Phase 4, Group 1).
 *
 * Every input is `.strict()`: the client may only ever supply the fields below.
 * Server-controlled values — sort order, cover state, provider metadata
 * (public_id, secure_url, width/height/format/byte_size), timestamps and IDs the
 * server assigns — are never accepted from a mutation body. Vehicle and image
 * identifiers are UUIDs. Optimistic-concurrency timestamps are validated as ISO
 * date-times; the service compares them against the stored `updated_at`.
 */

export const ALT_TEXT_MAX_LENGTH = 160;
/** A gallery holds at most this many images per vehicle. */
export const MAX_VEHICLE_IMAGES = 15;

const vehicleIdSchema = z.uuid({ message: "Invalid vehicle ID." });
const imageIdSchema = z.uuid({ message: "Invalid image ID." });

/**
 * Meaningful, human-authored alternative text: trimmed, non-empty, and bounded.
 * Every newly attached image and every edit must carry real text — an empty or
 * whitespace-only value is rejected rather than silently stored as blank.
 */
export const altTextSchema = z
  .string({ message: "Alternative text is required." })
  .trim()
  .min(1, { message: "Alternative text is required." })
  .max(ALT_TEXT_MAX_LENGTH, {
    message: `Alternative text must be at most ${ALT_TEXT_MAX_LENGTH} characters.`,
  });

const expectedUpdatedAtSchema = z.iso.datetime({
  message: "A valid record timestamp is required.",
});

/** The verified-upload envelope the provider hands back, mirrored from Phase 3. */
export const vehicleImageUploadSchema = z
  .object({
    publicId: z.string().trim().min(1).max(500),
    version: z.number().int().positive().safe(),
    signature: z.string().trim().min(1).max(200),
  })
  .strict();

export const listVehicleImagesSchema = z
  .object({ vehicleId: vehicleIdSchema })
  .strict();

/** Request a fresh signed upload authorization for a vehicle's gallery. */
export const uploadAuthorizationRequestSchema = z
  .object({ vehicleId: vehicleIdSchema })
  .strict();

export const attachVehicleImageSchema = z
  .object({
    vehicleId: vehicleIdSchema,
    upload: vehicleImageUploadSchema,
    altText: altTextSchema,
  })
  .strict();

export const reorderVehicleImagesSchema = z
  .object({
    vehicleId: vehicleIdSchema,
    // The complete current image set, in the desired order. Duplicates are
    // rejected here; the service additionally proves the set equals the stored
    // gallery exactly (no omissions, no foreign IDs).
    imageIds: z
      .array(imageIdSchema)
      .min(1, { message: "At least one image is required." })
      .max(MAX_VEHICLE_IMAGES)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Image IDs must not contain duplicates.",
      }),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

export const setVehicleCoverSchema = z
  .object({
    vehicleId: vehicleIdSchema,
    imageId: imageIdSchema,
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

export const updateVehicleImageAltTextSchema = z
  .object({
    vehicleId: vehicleIdSchema,
    imageId: imageIdSchema,
    altText: altTextSchema,
  })
  .strict();

export const removeVehicleImageSchema = z
  .object({
    vehicleId: vehicleIdSchema,
    imageId: imageIdSchema,
  })
  .strict();

export type VehicleImageUpload = z.output<typeof vehicleImageUploadSchema>;
export type ListVehicleImagesInput = z.input<typeof listVehicleImagesSchema>;
export type UploadAuthorizationRequestInput = z.input<
  typeof uploadAuthorizationRequestSchema
>;
export type AttachVehicleImageInput = z.input<typeof attachVehicleImageSchema>;
export type ReorderVehicleImagesInput = z.input<
  typeof reorderVehicleImagesSchema
>;
export type SetVehicleCoverInput = z.input<typeof setVehicleCoverSchema>;
export type UpdateVehicleImageAltTextInput = z.input<
  typeof updateVehicleImageAltTextSchema
>;
export type RemoveVehicleImageInput = z.input<typeof removeVehicleImageSchema>;
