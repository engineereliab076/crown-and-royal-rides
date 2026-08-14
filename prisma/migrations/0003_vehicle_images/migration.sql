-- Migration: 0003_vehicle_images
--
-- Crown and Royal Rides — Phase 3, Group 1. Adds the vehicle_images table. The
-- Prisma-representable parts (table, columns, vehicle_id index, cascading
-- foreign key) were generated with `prisma migrate diff` and then hand-edited
-- (reviewed) to add the two constructs Prisma cannot express. See docs/runbook.md
-- → "Raw-SQL migration review checklist".
--
-- Reviewed hand-written constructs (invisible to Prisma's schema diff, so
-- `db:migrate:verify` asserts each at the catalog level):
--
--   1. vehicle_images_one_cover_per_vehicle_idx — a PARTIAL unique index with
--      predicate WHERE is_cover = true. It permits many non-cover images per
--      vehicle but at most one cover image. Prisma cannot express a partial
--      index predicate, so it is hand-written and kept out of schema.prisma.
--      NULL note: is_cover is NOT NULL (DEFAULT false), so the predicate is
--      always true/false, never NULL — the partial set is exact.
--   2. vehicle_images_vehicle_id_sort_order_key — a UNIQUE constraint on
--      (vehicle_id, sort_order) declared DEFERRABLE INITIALLY IMMEDIATE. It is a
--      constraint (not a bare index) because only constraints can be deferrable;
--      deferral lets a whole-gallery reorder swap sort_order values within one
--      transaction without tripping uniqueness mid-statement. Prisma cannot
--      express DEFERRABLE, so it is hand-written and kept out of schema.prisma.
--
-- Deleting a vehicle cascades to its image rows (ON DELETE CASCADE). This
-- migration is additive and does not touch 0001/0002. Once applied to any shared
-- environment it is frozen; further change arrives as a new migration.

-- CreateTable
CREATE TABLE "vehicle_images" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "secure_url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_images_vehicle_id_idx" ON "vehicle_images"("vehicle_id");

-- Custom (manually added, reviewed): at most one cover image per vehicle.
-- Partial unique index — the predicate restricts uniqueness to cover rows.
CREATE UNIQUE INDEX "vehicle_images_one_cover_per_vehicle_idx" ON "vehicle_images" ("vehicle_id") WHERE ("is_cover" = true);

-- AddForeignKey
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom (manually added, reviewed): DEFERRABLE unique gallery ordering. Declared
-- INITIALLY IMMEDIATE so it behaves normally unless a transaction explicitly
-- defers it (SET CONSTRAINTS ... DEFERRED) to reorder a whole gallery at once.
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_sort_order_key" UNIQUE ("vehicle_id", "sort_order") DEFERRABLE INITIALLY IMMEDIATE;
