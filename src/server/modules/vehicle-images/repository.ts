import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { VehicleImageRecord } from "@/server/modules/vehicle-images/dto";

/**
 * Prisma repository for the vehicle-image gallery.
 *
 * Every read uses an explicit `select` — no Prisma record is ever spread — so
 * the row shape that leaves this module is exactly the internal
 * {@link VehicleImageRecord} (which still carries `publicId` for server-side
 * provider deletion; the DTO layer strips it). The locking and ordering
 * operations use tagged/parameterized raw SQL and are safe to run against either
 * the base client or an interactive-transaction client; the mutating gallery
 * operations are intended to run inside a transaction that has already locked the
 * parent vehicle row.
 */

const IMAGE_SELECT = {
  id: true,
  publicId: true,
  secureUrl: true,
  width: true,
  height: true,
  format: true,
  altText: true,
  sortOrder: true,
  isCover: true,
  createdAt: true,
} as const satisfies Prisma.VehicleImageSelect;

export interface CreateVehicleImageRecord {
  readonly vehicleId: string;
  readonly publicId: string;
  readonly secureUrl: string;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly byteSize: number;
  readonly altText: string;
  readonly sortOrder: number;
  readonly isCover: boolean;
}

export interface VehicleLockRecord {
  readonly id: string;
  readonly updatedAt: Date;
  /** Public address; used to revalidate the published cache after a change. */
  readonly slug: string;
  /** Publication state; only a published vehicle needs cache revalidation. */
  readonly listingState: string;
}

export interface VehicleImageRepository {
  /** Non-locking existence + timestamp probe, used by read-only listing. */
  findVehicleTimestamp(vehicleId: string): Promise<VehicleLockRecord | null>;
  /**
   * Lock the parent vehicle row (`SELECT … FOR UPDATE`) and return its current
   * `updated_at`, serializing concurrent gallery mutations for that vehicle.
   */
  lockVehicle(vehicleId: string): Promise<VehicleLockRecord | null>;
  /** Images for a vehicle in `sort_order ASC, id ASC`. */
  listImages(vehicleId: string): Promise<readonly VehicleImageRecord[]>;
  countImages(vehicleId: string): Promise<number>;
  /** Detect any image already attached with this provider public ID. */
  findImageByPublicId(
    publicId: string,
  ): Promise<{ readonly id: string } | null>;
  createImage(input: CreateVehicleImageRecord): Promise<VehicleImageRecord>;
  /**
   * Replace the sort order of the given images in one shot. The DEFERRABLE
   * `(vehicle_id, sort_order)` unique is deferred first so a whole-gallery
   * permutation cannot trip uniqueness mid-statement.
   */
  replaceSortOrders(
    orders: readonly { readonly id: string; readonly sortOrder: number }[],
  ): Promise<void>;
  clearCover(vehicleId: string): Promise<void>;
  setCover(imageId: string): Promise<void>;
  updateAltText(imageId: string, altText: string): Promise<VehicleImageRecord>;
  deleteImage(imageId: string): Promise<void>;
  /** Bump the parent vehicle's `updated_at` and return the new value. */
  touchVehicle(vehicleId: string): Promise<Date>;
}

export type VehicleImagePrismaClient = Pick<
  PrismaClient,
  "vehicleImage" | "$queryRaw" | "$executeRawUnsafe"
>;

function toRecord(row: {
  id: string;
  publicId: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  createdAt: Date;
}): VehicleImageRecord {
  return {
    id: row.id,
    publicId: row.publicId,
    secureUrl: row.secureUrl,
    width: row.width,
    height: row.height,
    format: row.format,
    altText: row.altText,
    sortOrder: row.sortOrder,
    isCover: row.isCover,
    createdAt: row.createdAt,
  };
}

export function createPrismaVehicleImageRepository(
  client: VehicleImagePrismaClient,
): VehicleImageRepository {
  return {
    async findVehicleTimestamp(vehicleId) {
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          updated_at: Date;
          slug: string;
          listing_state: string;
        }>
      >`SELECT "id", "updated_at", "slug", "listing_state" FROM "vehicles" WHERE "id" = ${vehicleId}::uuid`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            updatedAt: row.updated_at,
            slug: row.slug,
            listingState: row.listing_state,
          };
    },

    async lockVehicle(vehicleId) {
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          updated_at: Date;
          slug: string;
          listing_state: string;
        }>
      >`SELECT "id", "updated_at", "slug", "listing_state" FROM "vehicles" WHERE "id" = ${vehicleId}::uuid FOR UPDATE`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            updatedAt: row.updated_at,
            slug: row.slug,
            listingState: row.listing_state,
          };
    },

    async listImages(vehicleId) {
      const rows = await client.vehicleImage.findMany({
        where: { vehicleId },
        select: IMAGE_SELECT,
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      return rows.map(toRecord);
    },

    async countImages(vehicleId) {
      return client.vehicleImage.count({ where: { vehicleId } });
    },

    async findImageByPublicId(publicId) {
      return client.vehicleImage.findFirst({
        where: { publicId },
        select: { id: true },
      });
    },

    async createImage(input) {
      const created = await client.vehicleImage.create({
        data: {
          vehicleId: input.vehicleId,
          publicId: input.publicId,
          secureUrl: input.secureUrl,
          width: input.width,
          height: input.height,
          format: input.format,
          byteSize: input.byteSize,
          altText: input.altText,
          sortOrder: input.sortOrder,
          isCover: input.isCover,
        },
        select: IMAGE_SELECT,
      });
      return toRecord(created);
    },

    async replaceSortOrders(orders) {
      // Defer the (vehicle_id, sort_order) unique for this transaction so a full
      // permutation is validated once, at COMMIT, rather than after each UPDATE.
      // No negative/temporary ordering is used — the deferral is the mechanism
      // the schema was designed for.
      await client.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
      for (const order of orders) {
        await client.vehicleImage.update({
          where: { id: order.id },
          data: { sortOrder: order.sortOrder },
        });
      }
    },

    async clearCover(vehicleId) {
      await client.vehicleImage.updateMany({
        where: { vehicleId, isCover: true },
        data: { isCover: false },
      });
    },

    async setCover(imageId) {
      await client.vehicleImage.update({
        where: { id: imageId },
        data: { isCover: true },
      });
    },

    async updateAltText(imageId, altText) {
      const updated = await client.vehicleImage.update({
        where: { id: imageId },
        data: { altText },
        select: IMAGE_SELECT,
      });
      return toRecord(updated);
    },

    async deleteImage(imageId) {
      await client.vehicleImage.delete({ where: { id: imageId } });
    },

    async touchVehicle(vehicleId) {
      const rows = await client.$queryRaw<
        Array<{ updated_at: Date }>
      >`UPDATE "vehicles" SET "updated_at" = now() WHERE "id" = ${vehicleId}::uuid RETURNING "updated_at"`;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("Vehicle disappeared during a locked gallery update.");
      }
      return row.updated_at;
    },
  };
}
