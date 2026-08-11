-- Migration: 0001_foundation
--
-- Crown and Royal Rides — Phase 1 foundation. Creates ONLY the genuinely shared
-- tables and enums. No feature tables (vehicles, inquiries, packages, ...).
--
-- This file was generated with `prisma migrate diff --from-empty --to-schema`
-- and then hand-edited (reviewed) to add three constructs Prisma cannot express
-- in the schema: the `citext` extension (required before the CITEXT column), the
-- named single-row CHECK constraint on `business_settings`, and NOT NULL on
-- `business_settings.inquiry_notification_emails` (Prisma renders a required
-- scalar list as a nullable column). See docs/runbook.md → "Database migrations"
-- for the raw-SQL review checklist.
--
-- LAST PERMITTED EDIT TO 0001: this migration has only ever been applied to
-- disposable local test/scratch databases — never Production or Preview. The
-- NOT NULL correction above is made in place, before first deployment to any
-- shared environment. After 0001 reaches a shared environment it is frozen;
-- any further change must arrive as a new, additive migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Enable case-insensitive text. MUST run before any CITEXT column is created
-- (admin_users.email below). Idempotent; part of migration history so every
-- environment enables it identically rather than out-of-band on one database.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('owner', 'manager');

-- CreateEnum
CREATE TYPE "listing_state" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "admin_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" SMALLINT NOT NULL,
    "business_name" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "primary_phone" TEXT NOT NULL,
    "secondary_phone" TEXT,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "opening_hours" JSONB NOT NULL,
    "social_links" JSONB NOT NULL,
    "hero_headline" TEXT NOT NULL,
    "hero_subheadline" TEXT NOT NULL,
    -- Custom (manually added, reviewed): Prisma renders a required `String[]`
    -- scalar list as a NULLABLE `TEXT[]` at the database level. The intended
    -- invariant is that the list is always present (empty `[]` means "no
    -- recipients"; NULL is meaningless and forbidden), so NOT NULL is enforced
    -- here. No default is set: the single settings row supplies the list
    -- explicitly. This construct is invisible to Prisma's schema diff, so the
    -- drift check (`db:migrate:verify`) asserts it at the catalog level.
    "inquiry_notification_emails" TEXT[] NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_deletion_queue" (
    "id" BIGSERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempted_at" TIMESTAMPTZ(6),

    CONSTRAINT "media_deletion_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_log_actor_id_idx" ON "admin_audit_log"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom (manually added, reviewed): single-row guard for business_settings.
-- Prisma cannot express arbitrary CHECK constraints in the schema, so this is
-- maintained here. The stable name lets later migrations reference or drop it.
-- Note on NULL semantics: `id` is the PRIMARY KEY (NOT NULL), so the CHECK can
-- never evaluate to NULL and therefore always enforces exactly `id = 1`.
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_singleton_check" CHECK ("id" = 1);
