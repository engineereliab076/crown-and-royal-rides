import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export interface PublicBusinessSettings {
  readonly businessName: string;
  readonly whatsappNumber: string;
  readonly primaryPhone: string;
  readonly secondaryPhone: string | null;
  readonly email: string;
  readonly address: string;
  readonly openingHours: Prisma.JsonValue;
  readonly socialLinks: Prisma.JsonValue;
  readonly heroHeadline: string;
  readonly heroSubheadline: string;
  readonly inquiryNotificationEmails: string[];
  readonly updatedAt: Date;
  readonly updatedById: string | null;
}

export interface UpdateBusinessSettingsRecord {
  readonly businessName: string;
  readonly whatsappNumber: string;
  readonly primaryPhone: string;
  readonly secondaryPhone: string | null;
  readonly email: string;
  readonly address: string;
  readonly openingHours: Prisma.InputJsonValue;
  readonly socialLinks: Prisma.InputJsonValue;
  readonly heroHeadline: string;
  readonly heroSubheadline: string;
  readonly inquiryNotificationEmails: string[];
  readonly updatedById: string;
}

export interface SettingsRepository {
  findSingleton(): Promise<PublicBusinessSettings | null>;
  updateSingleton(
    input: UpdateBusinessSettingsRecord,
  ): Promise<PublicBusinessSettings>;
}

export type SettingsPrismaClient = Pick<PrismaClient, "businessSettings">;

export const PUBLIC_SETTINGS_SELECT = {
  businessName: true,
  whatsappNumber: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  address: true,
  openingHours: true,
  socialLinks: true,
  heroHeadline: true,
  heroSubheadline: true,
  inquiryNotificationEmails: true,
  updatedAt: true,
  updatedById: true,
} as const;

export function createPrismaSettingsRepository(
  client: SettingsPrismaClient,
): SettingsRepository {
  return {
    async findSingleton() {
      return client.businessSettings.findUnique({
        where: { id: 1 },
        select: PUBLIC_SETTINGS_SELECT,
      });
    },

    async updateSingleton(input) {
      return client.businessSettings.update({
        where: { id: 1 },
        data: input,
        select: PUBLIC_SETTINGS_SELECT,
      });
    },
  };
}
