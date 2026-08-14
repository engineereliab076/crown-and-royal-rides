import "server-only";

import type { BrandRecord } from "@/server/modules/brands/repository";

export interface BrandDTO {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly sortOrder: number;
}

export function toBrandDTO(brand: BrandRecord): BrandDTO {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logoUrl,
    sortOrder: brand.sortOrder,
  };
}
