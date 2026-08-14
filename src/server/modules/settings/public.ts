import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/http/errors";
import type {
  BusinessSettingsPublicRecord,
  PublicSettingsRepository,
} from "@/server/modules/settings/repository";

export interface BusinessSettingsPublicDTO {
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
}
export function toBusinessSettingsPublicDTO(
  record: BusinessSettingsPublicRecord,
): BusinessSettingsPublicDTO {
  return {
    businessName: record.businessName,
    whatsappNumber: record.whatsappNumber,
    primaryPhone: record.primaryPhone,
    secondaryPhone: record.secondaryPhone,
    email: record.email,
    address: record.address,
    openingHours: record.openingHours,
    socialLinks: record.socialLinks,
    heroHeadline: record.heroHeadline,
    heroSubheadline: record.heroSubheadline,
  };
}
export function createPublicSettingsService(input: {
  repository: PublicSettingsRepository;
  cache: (
    load: () => Promise<BusinessSettingsPublicDTO>,
  ) => Promise<BusinessSettingsPublicDTO>;
}) {
  return {
    async getPublicSettings(): Promise<BusinessSettingsPublicDTO> {
      return input.cache(async () => {
        const record = await input.repository.findPublicSingleton();
        if (record === null)
          throw new AppError({
            status: 404,
            code: "SETTINGS_NOT_CONFIGURED",
            message: "Business settings are not configured.",
          });
        return toBusinessSettingsPublicDTO(record);
      });
    },
  };
}
