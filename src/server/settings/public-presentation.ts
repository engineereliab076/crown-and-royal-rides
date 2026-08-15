import "server-only";

import { cache } from "react";

import { emailHref, phoneHref, whatsappHref } from "@/lib/public-contact";
import { siteConfig } from "@/lib/site";
import type { BusinessSettingsPublicDTO } from "@/server/modules/settings/public";
import { getPublicSettings } from "@/server/settings/services";

export interface PublicSettingsPresentation {
  readonly businessName: string;
  readonly heroHeadline: string;
  readonly heroSubheadline: string;
  readonly whatsappNumber: string | null;
  readonly whatsappUrl: string | null;
  readonly primaryPhone: string | null;
  readonly primaryPhoneUrl: string | null;
  readonly secondaryPhone: string | null;
  readonly secondaryPhoneUrl: string | null;
  readonly email: string | null;
  readonly emailUrl: string | null;
  readonly address: string | null;
  readonly openingHours: unknown;
  readonly socialLinks: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function present(
  settings: BusinessSettingsPublicDTO | null,
): PublicSettingsPresentation {
  const businessName = text(settings?.businessName) ?? siteConfig.name;
  const primaryPhone = text(settings?.primaryPhone);
  const secondaryPhone = text(settings?.secondaryPhone);
  const email = text(settings?.email);
  const whatsappNumber = text(settings?.whatsappNumber);
  return {
    businessName,
    heroHeadline:
      text(settings?.heroHeadline) ??
      "Find the right vehicle for your journey.",
    heroSubheadline:
      text(settings?.heroSubheadline) ??
      "Explore vehicles for sale and rent, with direct help when you need it.",
    whatsappNumber,
    whatsappUrl: whatsappHref(settings?.whatsappNumber),
    primaryPhone,
    primaryPhoneUrl: phoneHref(primaryPhone),
    secondaryPhone,
    secondaryPhoneUrl: phoneHref(secondaryPhone),
    email,
    emailUrl: emailHref(email),
    address: text(settings?.address),
    openingHours: settings?.openingHours ?? null,
    socialLinks: settings?.socialLinks ?? null,
  };
}

/** Request-deduplicated view over the tagged public-settings data cache. */
export const getPublicSettingsPresentation = cache(async () => {
  try {
    return present(await getPublicSettings());
  } catch {
    return present(null);
  }
});
