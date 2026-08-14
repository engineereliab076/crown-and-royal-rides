-- Migration: 0004_inquiries
--
-- Crown and Royal Rides — Phase 3, Group 1. Adds the inquiry foundation for the
-- two Phase 3 request kinds (purchase, viewing). The Prisma-representable parts
-- (enums, table, columns, reference/subject/type/status indexes, the nullable
-- vehicle foreign key) were generated with `prisma migrate diff` and then
-- hand-edited (reviewed) to add the CHECK constraints Prisma cannot express. See
-- docs/runbook.md → "Raw-SQL migration review checklist".
--
-- Rental packages do NOT exist yet (Phase 9). `package_id` is deliberately a bare
-- nullable UUID column with NO foreign key — a placeholder that only exists so
-- the subject-exclusivity CHECK can be written now. No rental_packages table is
-- created here.
--
-- Reviewed hand-written CHECK constraints (invisible to Prisma's schema diff, so
-- `db:migrate:verify` asserts each at the catalog level). `type` is NOT NULL and
-- the IS [NOT] NULL tests never yield NULL, so none of these can pass by
-- evaluating to NULL:
--
--   1. inquiries_subject_exclusive_check — exactly one subject: vehicle XOR
--      package. Rejects both-set and neither-set.
--   2. inquiries_purchase_fields_check — a purchase must reference a vehicle
--      subject and must NOT carry the viewing-only field (preferred_viewing_at).
--   3. inquiries_viewing_fields_check — a viewing must carry its viewing-specific
--      field (preferred_viewing_at).
--
-- This migration is additive and does not touch 0001/0002/0003. Once applied to
-- any shared environment it is frozen; further change arrives as a new migration.

-- CreateEnum
CREATE TYPE "inquiry_type" AS ENUM ('purchase', 'viewing');

-- CreateEnum
CREATE TYPE "inquiry_status" AS ENUM ('new', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "inquiry_type" NOT NULL,
    "status" "inquiry_status" NOT NULL DEFAULT 'new',
    "vehicle_id" UUID,
    "package_id" UUID,
    "subject_snapshot" JSONB NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "message" TEXT,
    "preferred_viewing_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_reference_key" ON "inquiries"("reference");

-- CreateIndex
CREATE INDEX "inquiries_vehicle_id_idx" ON "inquiries"("vehicle_id");

-- CreateIndex
CREATE INDEX "inquiries_type_idx" ON "inquiries"("type");

-- CreateIndex
CREATE INDEX "inquiries_status_idx" ON "inquiries"("status");

-- AddForeignKey. ON DELETE RESTRICT (not SET NULL): the subject-exclusivity
-- CHECK requires every inquiry to keep exactly one subject, so a vehicle that
-- still has inquiries cannot be hard-deleted (archive it instead). vehicle_id is
-- nullable only to support package-subject inquiries, never to be nulled here.
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom (manually added, reviewed): subject exclusivity and type-specific field
-- rules. Prisma cannot express arbitrary CHECK constraints; these stable names
-- are asserted by db:migrate:verify and referenced by the constraint tests.
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_subject_exclusive_check" CHECK (("vehicle_id" IS NOT NULL) <> ("package_id" IS NOT NULL));
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_purchase_fields_check" CHECK ("type" <> 'purchase' OR ("vehicle_id" IS NOT NULL AND "preferred_viewing_at" IS NULL));
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_viewing_fields_check" CHECK ("type" <> 'viewing' OR "preferred_viewing_at" IS NOT NULL);
