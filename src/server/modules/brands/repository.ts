import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

export interface BrandRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly sortOrder: number;
}
export interface BrandWriteRecord {
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly sortOrder: number;
}
export interface BrandRepository {
  list(): Promise<readonly BrandRecord[]>;
  findById(id: string): Promise<BrandRecord | null>;
  create(input: BrandWriteRecord): Promise<BrandRecord>;
  update(id: string, input: Partial<BrandWriteRecord>): Promise<BrandRecord>;
  remove(id: string): Promise<BrandRecord>;
  countVehicles(id: string): Promise<number>;
  propagateVehicleBrandName(id: string, name: string): Promise<number>;
  lock(id: string): Promise<boolean>;
}
export type BrandPrismaClient = Pick<
  PrismaClient,
  "brand" | "vehicle" | "$queryRaw"
>;
export const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  sortOrder: true,
} as const;

export function createPrismaBrandRepository(
  client: BrandPrismaClient,
): BrandRepository {
  return {
    async list() {
      return client.brand.findMany({
        select: BRAND_SELECT,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      });
    },
    async findById(id) {
      return client.brand.findUnique({ where: { id }, select: BRAND_SELECT });
    },
    async create(input) {
      return client.brand.create({ data: input, select: BRAND_SELECT });
    },
    async update(id, input) {
      return client.brand.update({
        where: { id },
        data: input,
        select: BRAND_SELECT,
      });
    },
    async remove(id) {
      return client.brand.delete({ where: { id }, select: BRAND_SELECT });
    },
    async countVehicles(id) {
      return client.vehicle.count({ where: { brandId: id } });
    },
    async propagateVehicleBrandName(id, name) {
      const result = await client.vehicle.updateMany({
        where: { brandId: id },
        data: { brandName: name },
      });
      return result.count;
    },
    async lock(id) {
      const rows = await client.$queryRaw<
        readonly { id: string }[]
      >`SELECT "id" FROM "brands" WHERE "id" = ${id}::uuid FOR UPDATE`;
      return rows.length === 1;
    },
  };
}
