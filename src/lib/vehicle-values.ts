/** Client-safe, exhaustive vehicle option values shared by schemas and forms. */
export const BODY_TYPES = [
  "sedan",
  "suv",
  "hatchback",
  "coupe",
  "wagon",
  "pickup",
  "van",
  "convertible",
] as const;

export const VEHICLE_CONDITIONS = [
  "brand_new",
  "foreign_used",
  "locally_used",
] as const;

export const TRANSMISSIONS = ["automatic", "manual"] as const;
export const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
export const DRIVER_OPTIONS = ["with_driver", "without_driver"] as const;
export const SALE_STATUSES = ["available", "reserved", "sold"] as const;
export const RENTAL_STATUSES = [
  "available",
  "reserved",
  "rented",
  "unavailable",
] as const;
export const DRIVETRAINS = ["fwd", "rwd", "awd", "four_wd"] as const;
export const LISTING_STATES = ["draft", "published", "archived"] as const;

export type BodyTypeValue = (typeof BODY_TYPES)[number];
export type VehicleConditionValue = (typeof VEHICLE_CONDITIONS)[number];
export type TransmissionValue = (typeof TRANSMISSIONS)[number];
export type FuelTypeValue = (typeof FUEL_TYPES)[number];
export type DriverOptionValue = (typeof DRIVER_OPTIONS)[number];
export type SaleStatusValue = (typeof SALE_STATUSES)[number];
export type RentalStatusValue = (typeof RENTAL_STATUSES)[number];
export type DrivetrainValue = (typeof DRIVETRAINS)[number];
export type ListingStateValue = (typeof LISTING_STATES)[number];
