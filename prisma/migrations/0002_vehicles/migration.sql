-- Migration: 0002_vehicles
--
-- Crown and Royal Rides — Phase 3, Group 1. Adds the vehicle catalogue table and
-- its enums. The Prisma-representable parts (table, columns, enums, slug unique,
-- brand/listing indexes, brand foreign key) were generated with
-- `prisma migrate diff` and then hand-edited (reviewed) to add the constructs
-- Prisma cannot express in schema.prisma. See docs/runbook.md → "Raw-SQL
-- migration review checklist".
--
-- Reviewed hand-written constructs in this migration (invisible to Prisma's
-- schema diff, so `db:migrate:verify` asserts each at the catalog level):
--
--   1. CREATE EXTENSION pg_trgm — required before the trigram index below.
--   2. Two STORED generated columns, maintained by PostgreSQL on write:
--        * search_text   — plain concatenation of the denormalized brand name,
--                          model, and description; backs fuzzy/trigram search.
--        * search_vector — a full-text tsvector over the same content ('english'
--                          config; the two-arg form is IMMUTABLE, as generated
--                          columns require). schema.prisma declares both only as
--                          opaque `Unsupported` columns, so the GENERATED clause
--                          is invisible to the diff.
--   3. A GIN index on search_vector (full-text) and a GIN pg_trgm index on
--      search_text (fuzzy). Prisma cannot express operator-class/GIN indexes on
--      these columns, so they are hand-written.
--   4. Named CHECK constraints for the single commercial (sale) mode and the
--      bounded year. Prisma cannot express arbitrary CHECKs; stable names let
--      tests and later migrations reference them:
--        * vehicles_sale_price_positive_check   — a present price is > 0.
--        * vehicles_sale_status_required_check   — for-sale ⇒ sale_status set.
--        * vehicles_sale_price_required_check    — for-sale ⇒ sale_price set.
--        * vehicles_sale_disabled_null_check     — not-for-sale ⇒ both sale
--                                                  fields NULL (no dangling
--                                                  commercial state).
--        * vehicles_year_range_check             — 1980 ≤ year ≤ 2100 (matches
--                                                  createVehicleSlug in
--                                                  src/lib/slug.ts).
--      is_for_sale is NOT NULL (DEFAULT false), so none of these CHECKs can
--      evaluate to NULL on the is_for_sale branch — they always enforce.
--
-- This migration is additive and does not touch 0001_foundation. Once applied to
-- any shared environment it is frozen; further change arrives as a new migration.

-- Enable trigram matching. MUST run before the pg_trgm index below. Idempotent;
-- part of migration history so every environment enables it identically.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "body_type" AS ENUM ('sedan', 'suv', 'hatchback', 'coupe', 'wagon', 'pickup', 'van', 'convertible');

-- CreateEnum
CREATE TYPE "vehicle_condition" AS ENUM ('brand_new', 'foreign_used', 'locally_used');

-- CreateEnum
CREATE TYPE "transmission" AS ENUM ('automatic', 'manual');

-- CreateEnum
CREATE TYPE "fuel_type" AS ENUM ('petrol', 'diesel', 'hybrid', 'electric');

-- CreateEnum
CREATE TYPE "driver_option" AS ENUM ('with_driver', 'without_driver');

-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('available', 'reserved', 'sold');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "body_type" "body_type" NOT NULL,
    "condition" "vehicle_condition" NOT NULL,
    "transmission" "transmission" NOT NULL,
    "fuel_type" "fuel_type" NOT NULL,
    "driver_option" "driver_option" NOT NULL,
    "listing_state" "listing_state" NOT NULL DEFAULT 'draft',
    "is_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "sale_status" "sale_status",
    "sale_price" BIGINT,
    "description" TEXT,
    "published_at" TIMESTAMPTZ(6),
    -- Custom (manually added, reviewed): STORED generated columns. search_text is
    -- a plain concatenation used by the trigram index; search_vector is the
    -- full-text tsvector. Both derive from brand_name + model + description and
    -- are recomputed by PostgreSQL on every write. schema.prisma models these as
    -- opaque Unsupported("text")/Unsupported("tsvector") columns, so the
    -- generation expressions here are invisible to the Prisma diff.
    "search_text" text GENERATED ALWAYS AS (
        "brand_name" || ' ' || "model" || ' ' || COALESCE("description", '')
    ) STORED,
    "search_vector" tsvector GENERATED ALWAYS AS (
        to_tsvector('english', "brand_name" || ' ' || "model" || ' ' || COALESCE("description", ''))
    ) STORED,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_slug_key" ON "vehicles"("slug");

-- CreateIndex
CREATE INDEX "vehicles_brand_id_idx" ON "vehicles"("brand_id");

-- CreateIndex
CREATE INDEX "vehicles_listing_state_idx" ON "vehicles"("listing_state");

-- Custom (manually added, reviewed): full-text and fuzzy search indexes over the
-- generated columns. The GIN full-text index backs to_tsvector/@@ queries; the
-- GIN pg_trgm index backs ILIKE/similarity queries on the concatenated text.
-- Prisma cannot express GIN or operator-class indexes on these columns.
CREATE INDEX "vehicles_search_vector_idx" ON "vehicles" USING GIN ("search_vector");
CREATE INDEX "vehicles_search_text_trgm_idx" ON "vehicles" USING GIN ("search_text" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom (manually added, reviewed): commercial (sale) mode and year invariants.
-- Prisma cannot express arbitrary CHECK constraints; these stable names are
-- asserted by db:migrate:verify and referenced by the constraint tests.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sale_price_positive_check" CHECK ("sale_price" IS NULL OR "sale_price" > 0);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sale_status_required_check" CHECK ("is_for_sale" = false OR "sale_status" IS NOT NULL);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sale_price_required_check" CHECK ("is_for_sale" = false OR "sale_price" IS NOT NULL);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sale_disabled_null_check" CHECK ("is_for_sale" = true OR ("sale_status" IS NULL AND "sale_price" IS NULL));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_year_range_check" CHECK ("year" >= 1980 AND "year" <= 2100);
