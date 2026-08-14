import "server-only";

import { unstable_cache } from "next/cache";
import type { BusinessSettingsPublicDTO } from "@/server/modules/settings/public";

export const SETTINGS_CACHE_TAG = "settings";
const SETTINGS_REVALIDATE_SECONDS = 300;

export async function getCachedPublicSettings(
  load: () => Promise<BusinessSettingsPublicDTO>,
): Promise<BusinessSettingsPublicDTO> {
  return unstable_cache(load, ["public-settings"], {
    revalidate: SETTINGS_REVALIDATE_SECONDS,
    tags: [SETTINGS_CACHE_TAG],
  })();
}
