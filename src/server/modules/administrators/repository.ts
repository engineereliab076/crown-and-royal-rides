import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AdminRole } from "@/generated/prisma/enums";

export interface PublicAdministrator {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
  readonly lastLoginAt: Date | null;
  readonly createdById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdministratorListQuery {
  readonly page: number;
  readonly limit: number;
  readonly role?: AdminRole;
  readonly isActive?: boolean;
}

export interface AdministratorPage {
  readonly items: readonly PublicAdministrator[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface CreateAdministratorRecord {
  readonly email: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly passwordHash: string;
  readonly createdById: string;
}

export interface AdministratorRepository {
  list(input: AdministratorListQuery): Promise<AdministratorPage>;
  findById(id: string): Promise<PublicAdministrator | null>;
  findByEmail(email: string): Promise<PublicAdministrator | null>;
  create(input: CreateAdministratorRecord): Promise<PublicAdministrator>;
  setRole(id: string, role: AdminRole): Promise<PublicAdministrator>;
  deactivate(id: string): Promise<PublicAdministrator>;
  reactivate(id: string): Promise<PublicAdministrator>;
  resetPassword(id: string, passwordHash: string): Promise<PublicAdministrator>;
  lockActiveOwners(): Promise<readonly { id: string }[]>;
}

export type AdministratorPrismaClient = Pick<
  PrismaClient,
  "adminUser" | "$queryRaw"
>;

export const PUBLIC_ADMINISTRATOR_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  sessionVersion: true,
  lastLoginAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function createPrismaAdministratorRepository(
  client: AdministratorPrismaClient,
): AdministratorRepository {
  return {
    async list(input) {
      const where = {
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      const [items, total] = await Promise.all([
        client.adminUser.findMany({
          where,
          select: PUBLIC_ADMINISTRATOR_SELECT,
          orderBy: [{ email: "asc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        client.adminUser.count({ where }),
      ]);
      return { items, total, page: input.page, limit: input.limit };
    },

    async findById(id) {
      return client.adminUser.findUnique({
        where: { id },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async findByEmail(email) {
      return client.adminUser.findUnique({
        where: { email },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async create(input) {
      return client.adminUser.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash: input.passwordHash,
          createdById: input.createdById,
          isActive: true,
          mustChangePassword: true,
        },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async setRole(id, role) {
      return client.adminUser.update({
        where: { id },
        data: { role, sessionVersion: { increment: 1 } },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async deactivate(id) {
      return client.adminUser.update({
        where: { id },
        data: { isActive: false, sessionVersion: { increment: 1 } },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async reactivate(id) {
      return client.adminUser.update({
        where: { id },
        data: { isActive: true },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async resetPassword(id, passwordHash) {
      return client.adminUser.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          sessionVersion: { increment: 1 },
        },
        select: PUBLIC_ADMINISTRATOR_SELECT,
      });
    },

    async lockActiveOwners() {
      return client.$queryRaw<readonly { id: string }[]>`
        SELECT "id"
        FROM "admin_users"
        WHERE "role" = 'owner'::"admin_role" AND "is_active" = true
        ORDER BY "id"
        FOR UPDATE
      `;
    },
  };
}
