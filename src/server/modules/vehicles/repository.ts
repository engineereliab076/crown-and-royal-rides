import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ListingState } from "@/generated/prisma/enums";
import type {
  BodyTypeValue,
  DriverOptionValue,
  FuelTypeValue,
  SaleStatusValue,
  TransmissionValue,
  VehicleConditionValue,
} from "@/lib/vehicle-values";

export const VEHICLE_IMAGE_SELECT = {
  secureUrl: true,
  width: true,
  height: true,
  altText: true,
  isCover: true,
  sortOrder: true,
} as const satisfies Prisma.VehicleImageSelect;

export const VEHICLE_PUBLIC_SELECT = {
  id: true,
  slug: true,
  brandName: true,
  model: true,
  year: true,
  bodyType: true,
  condition: true,
  transmission: true,
  fuelType: true,
  driverOption: true,
  isForSale: true,
  saleStatus: true,
  salePrice: true,
  description: true,
  images: {
    select: VEHICLE_IMAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.VehicleSelect;

export const VEHICLE_ADMIN_SELECT = {
  ...VEHICLE_PUBLIC_SELECT,
  brandId: true,
  listingState: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.VehicleSelect;

export const PUBLIC_BRAND_SELECT = {
  id: true,
  name: true,
} as const satisfies Prisma.BrandSelect;

export type VehiclePublicRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_SELECT;
}>;
export type VehicleAdminRecord = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_ADMIN_SELECT;
}>;

export interface VehicleBrandRecord {
  readonly id: string;
  readonly name: string;
}

export interface CreateVehicleRecord {
  readonly brandId: string;
  readonly brandName: string;
  readonly model: string;
  readonly slug: string;
  readonly year: number;
  readonly bodyType: BodyTypeValue;
  readonly condition: VehicleConditionValue;
  readonly transmission: TransmissionValue;
  readonly fuelType: FuelTypeValue;
  readonly driverOption: DriverOptionValue;
  readonly isForSale: boolean;
  readonly saleStatus: SaleStatusValue | null;
  readonly salePrice: bigint | null;
  readonly description: string | null;
}

export interface VehicleAdminPageRecord {
  readonly items: readonly VehicleAdminRecord[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface CreateVehicleCoverRecord {
  readonly publicId: string;
  readonly secureUrl: string;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly byteSize: number;
  readonly altText: string;
}

export interface VehicleRepository {
  findBrandById(id: string): Promise<VehicleBrandRecord | null>;
  listBrands(): Promise<readonly VehicleBrandRecord[]>;
  create(input: CreateVehicleRecord): Promise<VehicleAdminRecord>;
  findSlug(slug: string): Promise<{ readonly id: string } | null>;
  getAdminById(id: string): Promise<VehicleAdminRecord | null>;
  listAdmin(input: {
    page: number;
    limit: number;
  }): Promise<VehicleAdminPageRecord>;
  getPublicBySlug(slug: string): Promise<VehiclePublicRecord | null>;
  getPublicationCandidate(id: string): Promise<VehicleAdminRecord | null>;
  findImageByPublicId(
    publicId: string,
  ): Promise<{ readonly id: string } | null>;
  createCover(
    vehicleId: string,
    image: CreateVehicleCoverRecord,
  ): Promise<VehicleAdminRecord>;
  publish(id: string, publishedAt: Date): Promise<VehicleAdminRecord>;
}

export type VehiclePrismaClient = Pick<
  PrismaClient,
  "brand" | "vehicle" | "vehicleImage"
>;

export function createPrismaVehicleRepository(
  client: VehiclePrismaClient,
): VehicleRepository {
  return {
    async findBrandById(id) {
      return client.brand.findUnique({
        where: { id },
        select: PUBLIC_BRAND_SELECT,
      });
    },

    async listBrands() {
      return client.brand.findMany({
        select: PUBLIC_BRAND_SELECT,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      });
    },

    async create(input) {
      return client.vehicle.create({
        data: {
          brandId: input.brandId,
          brandName: input.brandName,
          model: input.model,
          slug: input.slug,
          year: input.year,
          bodyType: input.bodyType,
          condition: input.condition,
          transmission: input.transmission,
          fuelType: input.fuelType,
          driverOption: input.driverOption,
          listingState: ListingState.draft,
          isForSale: input.isForSale,
          saleStatus: input.saleStatus,
          salePrice: input.salePrice,
          description: input.description,
          publishedAt: null,
        },
        select: VEHICLE_ADMIN_SELECT,
      });
    },

    async findSlug(slug) {
      return client.vehicle.findUnique({
        where: { slug },
        select: { id: true },
      });
    },

    async getAdminById(id) {
      return client.vehicle.findUnique({
        where: { id },
        select: VEHICLE_ADMIN_SELECT,
      });
    },

    async listAdmin(input) {
      const [items, total] = await Promise.all([
        client.vehicle.findMany({
          select: VEHICLE_ADMIN_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        client.vehicle.count(),
      ]);
      return { items, total, page: input.page, limit: input.limit };
    },

    async getPublicBySlug(slug) {
      return client.vehicle.findFirst({
        where: { slug, listingState: ListingState.published },
        select: VEHICLE_PUBLIC_SELECT,
      });
    },

    async getPublicationCandidate(id) {
      return client.vehicle.findUnique({
        where: { id },
        select: VEHICLE_ADMIN_SELECT,
      });
    },

    async findImageByPublicId(publicId) {
      return client.vehicleImage.findFirst({
        where: { publicId },
        select: { id: true },
      });
    },

    async createCover(vehicleId, image) {
      return client.vehicle.update({
        where: { id: vehicleId },
        data: {
          images: {
            create: {
              publicId: image.publicId,
              secureUrl: image.secureUrl,
              width: image.width,
              height: image.height,
              format: image.format,
              byteSize: image.byteSize,
              altText: image.altText,
              sortOrder: 0,
              isCover: true,
            },
          },
        },
        select: VEHICLE_ADMIN_SELECT,
      });
    },

    async publish(id, publishedAt) {
      return client.vehicle.update({
        where: { id },
        data: { listingState: ListingState.published, publishedAt },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
  };
}
