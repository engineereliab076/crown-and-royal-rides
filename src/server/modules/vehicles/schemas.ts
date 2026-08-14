import { z } from "zod";

import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  FUEL_TYPES,
  SALE_STATUSES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";

/**
 * Strict Zod schemas for the minimal Phase 3 vehicle surface.
 *
 * The client may only ever supply the fields below. Server-controlled fields
 * (slug, brandName, listingState, publishedAt, the generated search columns,
 * IDs, timestamps, images) are never accepted: they are absent from every shape
 * and `.strict()` rejects any unknown key. Enum values come exclusively from the
 * generated Prisma enum types so the schema cannot drift from the database.
 *
 * The request shape genuinely differs by commercial mode, so `create` is a
 * discriminated union on `isForSale` rather than one overly optional object:
 *   - for-sale  ⇒ `saleStatus` and a positive `salePrice` are REQUIRED;
 *   - not-for-sale ⇒ `saleStatus`/`salePrice` must be absent or null.
 *
 * `salePrice` is validated here as a non-negative safe integer *number*; the
 * service converts it to a `BigInt` (via `toBigIntShillings`) only after
 * validation succeeds, so an unsafe/fractional/negative value never reaches the
 * money layer.
 */

const MODEL_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 4000;
export const MIN_VEHICLE_YEAR = 1980;
export const MAX_VEHICLE_YEAR = 2100;

const brandIdSchema = z.uuid({ message: "Select a valid brand." });

const modelSchema = z
  .string()
  .trim()
  .min(1, { message: "Model is required." })
  .max(MODEL_MAX_LENGTH, {
    message: `Model must be at most ${MODEL_MAX_LENGTH} characters.`,
  });

const yearSchema = z
  .number({ message: "Year is required." })
  .int({ message: "Year must be a whole number." })
  .min(MIN_VEHICLE_YEAR, {
    message: `Year must be ${MIN_VEHICLE_YEAR} or later.`,
  })
  .max(MAX_VEHICLE_YEAR, {
    message: `Year must be ${MAX_VEHICLE_YEAR} or earlier.`,
  });

// A draft may carry a short (or no) description; the publication gate — not the
// input schema — enforces the 40-character minimum required to go live.
const descriptionSchema = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX_LENGTH, {
    message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`,
  })
  .optional();

// A present sale price is a positive, safe integer number of whole shillings.
const salePriceSchema = z
  .number({ message: "Sale price is required when the vehicle is for sale." })
  .int({ message: "Sale price must be a whole number of shillings." })
  .min(1, { message: "Sale price must be greater than zero." })
  .max(Number.MAX_SAFE_INTEGER, { message: "Sale price is too large." });

const vehicleCoreShape = {
  brandId: brandIdSchema,
  model: modelSchema,
  year: yearSchema,
  bodyType: z.enum(BODY_TYPES),
  condition: z.enum(VEHICLE_CONDITIONS),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.enum(FUEL_TYPES),
  driverOption: z.enum(DRIVER_OPTIONS),
  description: descriptionSchema,
} as const;

const forSaleVehicleSchema = z
  .object({
    ...vehicleCoreShape,
    isForSale: z.literal(true),
    saleStatus: z.enum(SALE_STATUSES),
    salePrice: salePriceSchema,
  })
  .strict();

const notForSaleVehicleSchema = z
  .object({
    ...vehicleCoreShape,
    isForSale: z.literal(false),
    // Absent or explicitly null only — a concrete status/price with the sale
    // mode disabled is a contradiction (also enforced by a database CHECK).
    saleStatus: z.null().optional(),
    salePrice: z.null().optional(),
  })
  .strict();

export const createVehicleSchema = z.discriminatedUnion("isForSale", [
  forSaleVehicleSchema,
  notForSaleVehicleSchema,
]);

export type CreateVehicleInput = z.input<typeof createVehicleSchema>;
export type CreateVehicleData = z.output<typeof createVehicleSchema>;

export const vehicleListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type VehicleListInput = z.input<typeof vehicleListQuerySchema>;
export type VehicleListQuery = z.output<typeof vehicleListQuerySchema>;

export const vehicleParamsSchema = z
  .object({ id: z.uuid({ message: "Invalid vehicle ID." }) })
  .strict();

export const vehicleIdSchema = z.uuid({ message: "Invalid vehicle ID." });

export const vehicleSlugSchema = z
  .string()
  .trim()
  .min(1, { message: "A vehicle slug is required." })
  .max(200, { message: "Invalid vehicle slug." });

export const vehicleActionSchema = z.object({}).strict();

export const mediaSignatureRequestSchema = z
  .object({ vehicleId: vehicleIdSchema })
  .strict();

export const completedVehicleUploadSchema = z
  .object({
    publicId: z.string().trim().min(1).max(500),
    version: z.number().int().positive().safe(),
    signature: z.string().trim().min(1).max(200),
  })
  .strict();

export type CompletedVehicleUpload = z.output<
  typeof completedVehicleUploadSchema
>;
