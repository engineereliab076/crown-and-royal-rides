/**
 * Temporary Phase 0 presentation configuration.
 *
 * This is static, non-authoritative branding copy used only to render the
 * visual shell. It intentionally excludes contact details, social links,
 * addresses, opening hours, prices, and navigation to routes that do not yet
 * exist. Future phases will replace the appropriate public-facing values with
 * database-backed business settings.
 */
export const siteConfig = {
  name: "Crown and Royal Rides",
  shortName: "Crown and Royal Rides",
  description:
    "Vehicle sales, rentals, and destination travel services in Tanzania.",
} as const;

export type SiteConfig = typeof siteConfig;
