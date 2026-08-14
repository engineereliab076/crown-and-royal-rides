import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ListingState,
  RentalStatus,
  SaleStatus,
} from "@/generated/prisma/enums";
import type {
  BodyTypeValue,
  DriverOptionValue,
  DrivetrainValue,
  FuelTypeValue,
  ListingStateValue,
  RentalStatusValue,
  SaleStatusValue,
  TransmissionValue,
  VehicleConditionValue,
} from "@/lib/vehicle-values";

export const VEHICLE_IMAGE_SELECT = {
  id: true,
  secureUrl: true,
  width: true,
  height: true,
  altText: true,
  isCover: true,
  sortOrder: true,
} as const satisfies Prisma.VehicleImageSelect;

const VEHICLE_SHARED_SELECT = {
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
  isNegotiable: true,
  location: true,
  isForRent: true,
  rentalStatus: true,
  rentalDailyPrice: true,
  minRentalDays: true,
  driverNote: true,
  mileageKm: true,
  engineCc: true,
  engineDescription: true,
  seats: true,
  doors: true,
  exteriorColor: true,
  interiorColor: true,
  drivetrain: true,
  features: true,
  isFeatured: true,
  description: true,
  images: {
    select: VEHICLE_IMAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.VehicleSelect;

export const VEHICLE_PUBLIC_SELECT = VEHICLE_SHARED_SELECT;
export const VEHICLE_ADMIN_SELECT = {
  ...VEHICLE_SHARED_SELECT,
  brandId: true,
  registrationNumber: true,
  chassisNumber: true,
  listingState: true,
  featuredAt: true,
  lastVerifiedAt: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.VehicleSelect;

type VehiclePublicPayload = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_PUBLIC_SELECT;
}>;
type Phase5PublicKeys =
  | "isNegotiable"
  | "location"
  | "isForRent"
  | "rentalStatus"
  | "rentalDailyPrice"
  | "minRentalDays"
  | "driverNote"
  | "mileageKm"
  | "engineCc"
  | "engineDescription"
  | "seats"
  | "doors"
  | "exteriorColor"
  | "interiorColor"
  | "drivetrain"
  | "features"
  | "isFeatured";
/** Optional Phase 5 keys keep Phase 4 repository consumers source-compatible. */
export type VehiclePublicRecord = Omit<VehiclePublicPayload, Phase5PublicKeys> &
  Partial<Pick<VehiclePublicPayload, Phase5PublicKeys>>;
type VehicleAdminPayload = Prisma.VehicleGetPayload<{
  select: typeof VEHICLE_ADMIN_SELECT;
}>;
type Phase5AdminKeys =
  | Phase5PublicKeys
  | "registrationNumber"
  | "chassisNumber"
  | "featuredAt"
  | "lastVerifiedAt";
export type VehicleAdminRecord = Omit<VehicleAdminPayload, Phase5AdminKeys> &
  Partial<Pick<VehicleAdminPayload, Phase5AdminKeys>>;

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
  readonly isForRent?: boolean;
  readonly rentalStatus?: RentalStatusValue | null;
  readonly rentalDailyPrice?: bigint | null;
  readonly minRentalDays?: number | null;
  readonly isNegotiable?: boolean;
  readonly registrationNumber?: string | null;
  readonly chassisNumber?: string | null;
  readonly location?: string | null;
  readonly driverNote?: string | null;
  readonly mileageKm?: number | null;
  readonly engineCc?: number | null;
  readonly engineDescription?: string | null;
  readonly seats?: number | null;
  readonly doors?: number | null;
  readonly exteriorColor?: string | null;
  readonly interiorColor?: string | null;
  readonly drivetrain?: DrivetrainValue | null;
  readonly features?: readonly string[];
  readonly description: string | null;
}

export interface VehicleAdminListQuery {
  readonly page: number;
  readonly limit: number;
  readonly search?: string;
  readonly listingState?: ListingStateValue;
  readonly saleStatus?: SaleStatusValue;
  readonly rentalStatus?: RentalStatusValue;
  readonly isForSale?: boolean;
  readonly isForRent?: boolean;
  readonly featured?: boolean;
  readonly verified?: boolean;
  readonly brandId?: string;
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

export type VehicleDraftUpdateRecord = Prisma.VehicleUncheckedUpdateInput;

export interface VehicleRepository {
  findBrandById(id: string): Promise<VehicleBrandRecord | null>;
  listBrands(): Promise<readonly VehicleBrandRecord[]>;
  create(input: CreateVehicleRecord): Promise<VehicleAdminRecord>;
  findSlug(slug: string): Promise<{ readonly id: string } | null>;
  getAdminById(id: string): Promise<VehicleAdminRecord | null>;
  listAdmin(input: VehicleAdminListQuery): Promise<VehicleAdminPageRecord>;
  getPublicBySlug(slug: string): Promise<VehiclePublicRecord | null>;
  listFeaturedPublic(): Promise<readonly VehiclePublicRecord[]>;
  getPublicationCandidate(id: string): Promise<VehicleAdminRecord | null>;
  updateDraft(
    id: string,
    data: VehicleDraftUpdateRecord,
  ): Promise<VehicleAdminRecord>;
  updateListingState(
    id: string,
    data: {
      listingState: ListingStateValue;
      publishedAt: Date | null;
      isFeatured?: boolean;
      featuredAt?: Date | null;
    },
  ): Promise<VehicleAdminRecord>;
  updateSaleStatus(
    id: string,
    status: SaleStatusValue,
  ): Promise<VehicleAdminRecord>;
  updateRentalStatus(
    id: string,
    status: RentalStatusValue,
  ): Promise<VehicleAdminRecord>;
  setFeatured(id: string, featuredAt: Date | null): Promise<VehicleAdminRecord>;
  markVerified(id: string, at: Date): Promise<VehicleAdminRecord>;
  countFeatured(): Promise<number>;
  lockVehicle(id: string): Promise<boolean>;
  lockFeaturedSet(): Promise<void>;
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
  "brand" | "vehicle" | "vehicleImage" | "$queryRaw"
>;

export function createPrismaVehicleRepository(
  client: VehiclePrismaClient,
): VehicleRepository {
  return {
    async findBrandById(id) {
      return client.brand.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
    },
    async listBrands() {
      return client.brand.findMany({
        select: { id: true, name: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      });
    },
    async create(input) {
      return client.vehicle.create({
        data: {
          ...input,
          isForRent: input.isForRent ?? false,
          rentalStatus: input.rentalStatus ?? null,
          rentalDailyPrice: input.rentalDailyPrice ?? null,
          minRentalDays: input.minRentalDays ?? null,
          isNegotiable: input.isNegotiable ?? false,
          registrationNumber: input.registrationNumber ?? null,
          chassisNumber: input.chassisNumber ?? null,
          location: input.location ?? null,
          driverNote: input.driverNote ?? null,
          mileageKm: input.mileageKm ?? null,
          engineCc: input.engineCc ?? null,
          engineDescription: input.engineDescription ?? null,
          seats: input.seats ?? null,
          doors: input.doors ?? null,
          exteriorColor: input.exteriorColor ?? null,
          interiorColor: input.interiorColor ?? null,
          drivetrain: input.drivetrain ?? null,
          features: [...(input.features ?? [])],
          listingState: ListingState.draft,
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
      const search = input.search?.trim();
      const where: Prisma.VehicleWhereInput = {
        ...(input.listingState === undefined
          ? {}
          : { listingState: input.listingState }),
        ...(input.saleStatus === undefined
          ? {}
          : { saleStatus: input.saleStatus }),
        ...(input.rentalStatus === undefined
          ? {}
          : { rentalStatus: input.rentalStatus }),
        ...(input.isForSale === undefined
          ? {}
          : { isForSale: input.isForSale }),
        ...(input.isForRent === undefined
          ? {}
          : { isForRent: input.isForRent }),
        ...(input.featured === undefined ? {} : { isFeatured: input.featured }),
        ...(input.verified === undefined
          ? {}
          : { lastVerifiedAt: input.verified ? { not: null } : null }),
        ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
        ...(search === undefined || search.length === 0
          ? {}
          : {
              OR: [
                { brandName: { contains: search, mode: "insensitive" } },
                { model: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }),
      };
      const [items, total] = await Promise.all([
        client.vehicle.findMany({
          where,
          select: VEHICLE_ADMIN_SELECT,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        client.vehicle.count({ where }),
      ]);
      return { items, total, page: input.page, limit: input.limit };
    },
    async getPublicBySlug(slug) {
      return client.vehicle.findFirst({
        where: {
          slug,
          listingState: ListingState.published,
          OR: [
            { isForSale: true, saleStatus: SaleStatus.available },
            { isForRent: true, rentalStatus: RentalStatus.available },
          ],
        },
        select: VEHICLE_PUBLIC_SELECT,
      });
    },
    async listFeaturedPublic() {
      return client.vehicle.findMany({
        where: {
          listingState: ListingState.published,
          isFeatured: true,
          OR: [
            { isForSale: true, saleStatus: SaleStatus.available },
            { isForRent: true, rentalStatus: RentalStatus.available },
          ],
        },
        select: VEHICLE_PUBLIC_SELECT,
        orderBy: [{ featuredAt: "desc" }, { id: "asc" }],
        take: 8,
      });
    },
    async getPublicationCandidate(id) {
      return client.vehicle.findUnique({
        where: { id },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async updateDraft(id, data) {
      return client.vehicle.update({
        where: { id },
        data,
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async updateListingState(id, data) {
      return client.vehicle.update({
        where: { id },
        data,
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async updateSaleStatus(id, status) {
      return client.vehicle.update({
        where: { id },
        data: { saleStatus: status },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async updateRentalStatus(id, status) {
      return client.vehicle.update({
        where: { id },
        data: { rentalStatus: status },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async setFeatured(id, featuredAt) {
      return client.vehicle.update({
        where: { id },
        data: { isFeatured: featuredAt !== null, featuredAt },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async markVerified(id, at) {
      return client.vehicle.update({
        where: { id },
        data: { lastVerifiedAt: at },
        select: VEHICLE_ADMIN_SELECT,
      });
    },
    async countFeatured() {
      return client.vehicle.count({ where: { isFeatured: true } });
    },
    async lockVehicle(id) {
      const rows = await client.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "vehicles" WHERE "id" = ${id}::uuid FOR UPDATE
      `;
      return rows.length === 1;
    },
    async lockFeaturedSet() {
      await client.$queryRaw<readonly { locked: string }[]>`
        SELECT pg_advisory_xact_lock(831605005)::text AS "locked"
      `;
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
        data: { images: { create: { ...image, sortOrder: 0, isCover: true } } },
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
