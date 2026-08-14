-- Migration: 0005_vehicle_admin_workflow
--
-- Crown and Royal Rides — Phase 5, Group 1. This is an additive migration over
-- the frozen Phase 3/4 history. It intentionally leaves the generated vehicle
-- search columns and their expressions unchanged.
--
-- Private vehicle identifiers are stored in application-normalized canonical
-- form (trimmed, upper-case, internal spaces/hyphens retained). The partial
-- unique indexes therefore enforce uniqueness over that stored form.

-- CreateEnum
CREATE TYPE "rental_status" AS ENUM ('available', 'reserved', 'rented', 'unavailable');

-- CreateEnum
CREATE TYPE "drivetrain" AS ENUM ('fwd', 'rwd', 'awd', 'four_wd');

-- AlterTable
ALTER TABLE "vehicles"
  ADD COLUMN "registration_number" TEXT,
  ADD COLUMN "chassis_number" TEXT,
  ADD COLUMN "features" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "location" TEXT,
  ADD COLUMN "is_negotiable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "min_rental_days" INTEGER,
  ADD COLUMN "driver_note" TEXT,
  ADD COLUMN "is_for_rent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rental_status" "rental_status",
  ADD COLUMN "rental_daily_price" BIGINT,
  ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featured_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "mileage_km" INTEGER,
  ADD COLUMN "engine_cc" INTEGER,
  ADD COLUMN "engine_description" TEXT,
  ADD COLUMN "seats" SMALLINT,
  ADD COLUMN "doors" SMALLINT,
  ADD COLUMN "exterior_color" TEXT,
  ADD COLUMN "interior_color" TEXT,
  ADD COLUMN "drivetrain" "drivetrain";

-- Reviewed raw-SQL constraints. All new fields remain nullable or safely
-- defaulted, so existing published vehicles remain published and unchanged.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rental_daily_price_positive_check" CHECK ("rental_daily_price" IS NULL OR "rental_daily_price" > 0);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rental_enabled_fields_check" CHECK ("is_for_rent" = false OR ("rental_status" IS NOT NULL AND "rental_daily_price" IS NOT NULL AND "min_rental_days" IS NOT NULL));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rental_disabled_null_check" CHECK ("is_for_rent" = true OR ("rental_status" IS NULL AND "rental_daily_price" IS NULL AND "min_rental_days" IS NULL));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_min_rental_days_range_check" CHECK ("min_rental_days" IS NULL OR "min_rental_days" BETWEEN 1 AND 365);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_mileage_km_range_check" CHECK ("mileage_km" IS NULL OR "mileage_km" BETWEEN 0 AND 2000000);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_engine_cc_range_check" CHECK ("engine_cc" IS NULL OR "engine_cc" BETWEEN 1 AND 10000);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_seats_range_check" CHECK ("seats" IS NULL OR "seats" BETWEEN 1 AND 60);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_doors_range_check" CHECK ("doors" IS NULL OR "doors" BETWEEN 1 AND 8);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_note_length_check" CHECK ("driver_note" IS NULL OR char_length("driver_note") <= 500);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_engine_description_length_check" CHECK ("engine_description" IS NULL OR char_length("engine_description") <= 120);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_exterior_color_length_check" CHECK ("exterior_color" IS NULL OR char_length("exterior_color") <= 40);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_interior_color_length_check" CHECK ("interior_color" IS NULL OR char_length("interior_color") <= 40);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_features_count_check" CHECK (cardinality("features") <= 50);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_featured_consistency_check" CHECK (("is_featured" = true AND "featured_at" IS NOT NULL) OR ("is_featured" = false AND "featured_at" IS NULL));

-- Private identifiers are unique only when present. Featured ordering matches
-- the public query (featured_at DESC, id ASC).
CREATE UNIQUE INDEX "vehicles_registration_number_key" ON "vehicles"("registration_number") WHERE "registration_number" IS NOT NULL;
CREATE UNIQUE INDEX "vehicles_chassis_number_key" ON "vehicles"("chassis_number") WHERE "chassis_number" IS NOT NULL;
CREATE INDEX "vehicles_featured_at_idx" ON "vehicles"("featured_at" DESC, "id" ASC) WHERE "is_featured" = true;

