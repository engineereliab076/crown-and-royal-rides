import { z } from "zod";

import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  DRIVETRAINS,
  FUEL_TYPES,
  LISTING_STATES,
  RENTAL_STATUSES,
  SALE_STATUSES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";

const MODEL_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 4000;
const LOCATION_MAX_LENGTH = 160;
export const MIN_VEHICLE_YEAR = 1980;
export const MAX_VEHICLE_YEAR = 2100;

const nullableTrimmed = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** Canonical private identifier: trim + uppercase; internal punctuation stays. */
export const privateVehicleIdentifierSchema = z
  .string()
  .trim()
  .max(120)
  .transform((value) => (value.length === 0 ? null : value.toUpperCase()))
  .nullable()
  .optional();

export const featuresSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .transform((features) => [...new Set(features)]);

const safeMoney = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const brandIdSchema = z.uuid({ message: "Select a valid brand." });
const modelSchema = z.string().trim().min(1).max(MODEL_MAX_LENGTH);
const yearSchema = z.number().int().min(MIN_VEHICLE_YEAR).max(MAX_VEHICLE_YEAR);
const descriptionSchema = z.string().trim().max(DESCRIPTION_MAX_LENGTH);

const commonDraftShape = {
  location: nullableTrimmed(LOCATION_MAX_LENGTH),
  isNegotiable: z.boolean().optional(),
  mileageKm: z.number().int().min(0).max(2_000_000).nullable().optional(),
  engineCc: z.number().int().min(1).max(10_000).nullable().optional(),
  engineDescription: nullableTrimmed(120),
  seats: z.number().int().min(1).max(60).nullable().optional(),
  doors: z.number().int().min(1).max(8).nullable().optional(),
  exteriorColor: nullableTrimmed(40),
  interiorColor: nullableTrimmed(40),
  drivetrain: z.enum(DRIVETRAINS).nullable().optional(),
  driverNote: nullableTrimmed(500),
  features: featuresSchema.optional(),
} as const;

const createVehicleObject = z
  .object({
    brandId: brandIdSchema,
    model: modelSchema,
    year: yearSchema,
    bodyType: z.enum(BODY_TYPES),
    condition: z.enum(VEHICLE_CONDITIONS),
    transmission: z.enum(TRANSMISSIONS),
    fuelType: z.enum(FUEL_TYPES),
    driverOption: z.enum(DRIVER_OPTIONS),
    description: descriptionSchema.optional(),
    isForSale: z.boolean(),
    saleStatus: z.enum(SALE_STATUSES).nullable().optional(),
    salePrice: safeMoney.nullable().optional(),
    isForRent: z.boolean().default(false),
    rentalStatus: z.enum(RENTAL_STATUSES).nullable().optional(),
    rentalDailyPrice: safeMoney.nullable().optional(),
    minRentalDays: z.number().int().min(1).max(365).nullable().optional(),
    ...commonDraftShape,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isForSale) {
      if (value.saleStatus == null)
        context.addIssue({
          code: "custom",
          path: ["saleStatus"],
          message: "Sale status is required.",
        });
      if (value.salePrice == null)
        context.addIssue({
          code: "custom",
          path: ["salePrice"],
          message: "Sale price is required.",
        });
    } else if (value.saleStatus != null || value.salePrice != null) {
      context.addIssue({
        code: "custom",
        path: ["isForSale"],
        message: "Disabled sale fields must be empty.",
      });
    }
    if (value.isForRent) {
      if (value.rentalStatus == null)
        context.addIssue({
          code: "custom",
          path: ["rentalStatus"],
          message: "Rental status is required.",
        });
      if (value.rentalDailyPrice == null)
        context.addIssue({
          code: "custom",
          path: ["rentalDailyPrice"],
          message: "Daily price is required.",
        });
      if (value.minRentalDays == null)
        context.addIssue({
          code: "custom",
          path: ["minRentalDays"],
          message: "Minimum rental days is required.",
        });
    } else if (
      value.rentalStatus != null ||
      value.rentalDailyPrice != null ||
      value.minRentalDays != null
    ) {
      context.addIssue({
        code: "custom",
        path: ["isForRent"],
        message: "Disabled rental fields must be empty.",
      });
    }
  });

export const createVehicleSchema = createVehicleObject;
export type CreateVehicleInput = z.input<typeof createVehicleSchema>;
export type CreateVehicleData = z.output<typeof createVehicleSchema>;

export const vehicleBasicsUpdateSchema = z
  .object({
    brandId: brandIdSchema.optional(),
    model: modelSchema.optional(),
    year: yearSchema.optional(),
    bodyType: z.enum(BODY_TYPES).optional(),
    condition: z.enum(VEHICLE_CONDITIONS).optional(),
    transmission: z.enum(TRANSMISSIONS).optional(),
    fuelType: z.enum(FUEL_TYPES).optional(),
    drivetrain: z.enum(DRIVETRAINS).nullable().optional(),
    location: nullableTrimmed(LOCATION_MAX_LENGTH),
  })
  .strict();

export const vehicleModesAndPricingUpdateSchema = z
  .object({
    isForSale: z.boolean(),
    saleStatus: z.enum(SALE_STATUSES).nullable().optional(),
    salePrice: safeMoney.nullable().optional(),
    isNegotiable: z.boolean().default(false),
    isForRent: z.boolean(),
    rentalStatus: z.enum(RENTAL_STATUSES).nullable().optional(),
    rentalDailyPrice: safeMoney.nullable().optional(),
    minRentalDays: z.number().int().min(1).max(365).nullable().optional(),
  })
  .strict()
  .transform((value, context) => {
    if (
      value.isForSale &&
      (value.saleStatus == null || value.salePrice == null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["isForSale"],
        message: "Enabled sale mode requires status and price.",
      });
      return z.NEVER;
    }
    if (
      value.isForRent &&
      (value.rentalStatus == null ||
        value.rentalDailyPrice == null ||
        value.minRentalDays == null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["isForRent"],
        message:
          "Enabled rental mode requires status, daily price, and minimum days.",
      });
      return z.NEVER;
    }
    return {
      ...value,
      saleStatus: value.isForSale ? (value.saleStatus ?? null) : null,
      salePrice: value.isForSale ? (value.salePrice ?? null) : null,
      rentalStatus: value.isForRent ? (value.rentalStatus ?? null) : null,
      rentalDailyPrice: value.isForRent
        ? (value.rentalDailyPrice ?? null)
        : null,
      minRentalDays: value.isForRent ? (value.minRentalDays ?? null) : null,
    };
  });

export const vehicleDriverArrangementUpdateSchema = z
  .object({
    driverOption: z.enum(DRIVER_OPTIONS),
    driverNote: nullableTrimmed(500),
  })
  .strict();

// The Step 4 specifications update is the ONLY schema that accepts the private
// vehicle identifiers. Creation and the basics/modes/driver/description update
// schemas deliberately omit them so strict validation rejects them elsewhere.
export const vehicleSpecificationsUpdateSchema = z
  .object({
    mileageKm: z.number().int().min(0).max(2_000_000).nullable().optional(),
    engineCc: z.number().int().min(1).max(10_000).nullable().optional(),
    engineDescription: nullableTrimmed(120),
    seats: z.number().int().min(1).max(60).nullable().optional(),
    doors: z.number().int().min(1).max(8).nullable().optional(),
    exteriorColor: nullableTrimmed(40),
    interiorColor: nullableTrimmed(40),
    drivetrain: z.enum(DRIVETRAINS).nullable().optional(),
    registrationNumber: privateVehicleIdentifierSchema,
    chassisNumber: privateVehicleIdentifierSchema,
  })
  .strict();

export const vehicleDescriptionAndFeaturesUpdateSchema = z
  .object({
    description: descriptionSchema.nullable().optional(),
    features: featuresSchema.optional(),
  })
  .strict();

export const vehicleStepUpdateSchema = z.discriminatedUnion("step", [
  z
    .object({ step: z.literal("basics"), data: vehicleBasicsUpdateSchema })
    .strict(),
  z
    .object({
      step: z.literal("modes-and-pricing"),
      data: vehicleModesAndPricingUpdateSchema,
    })
    .strict(),
  z
    .object({
      step: z.literal("driver-arrangement"),
      data: vehicleDriverArrangementUpdateSchema,
    })
    .strict(),
  z
    .object({
      step: z.literal("specifications"),
      data: vehicleSpecificationsUpdateSchema,
    })
    .strict(),
  z
    .object({
      step: z.literal("description-and-features"),
      data: vehicleDescriptionAndFeaturesUpdateSchema,
    })
    .strict(),
]);
export type VehicleStepUpdateInput = z.input<typeof vehicleStepUpdateSchema>;
export type VehicleStepUpdateData = z.output<typeof vehicleStepUpdateSchema>;

const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const vehicleListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    listingState: z.enum(LISTING_STATES).optional(),
    saleStatus: z.enum(SALE_STATUSES).optional(),
    rentalStatus: z.enum(RENTAL_STATUSES).optional(),
    isForSale: queryBoolean.optional(),
    isForRent: queryBoolean.optional(),
    featured: queryBoolean.optional(),
    verified: queryBoolean.optional(),
    brandId: z.uuid().optional(),
  })
  .strict();
export type VehicleListInput = z.input<typeof vehicleListQuerySchema>;
export type VehicleListQuery = z.output<typeof vehicleListQuerySchema>;

export const VEHICLE_TRANSITION_ACTIONS = [
  "publish",
  "unpublish",
  "archive",
  "restore",
  "sale_available",
  "sale_reserved",
  "sale_sold",
  "rental_available",
  "rental_reserved",
  "rental_rented",
  "rental_unavailable",
] as const;
export const vehicleTransitionSchema = z
  .object({ action: z.enum(VEHICLE_TRANSITION_ACTIONS) })
  .strict();
export type VehicleTransitionAction =
  (typeof VEHICLE_TRANSITION_ACTIONS)[number];
export type VehicleTransitionInput = {
  readonly vehicleId: string;
  readonly action: VehicleTransitionAction;
};

export const featureVehicleSchema = z
  .object({ featured: z.boolean() })
  .strict();
export const vehicleParamsSchema = z
  .object({ id: z.uuid({ message: "Invalid vehicle ID." }) })
  .strict();
export const vehicleIdSchema = z.uuid({ message: "Invalid vehicle ID." });
export const vehicleSlugSchema = z.string().trim().min(1).max(200);
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
