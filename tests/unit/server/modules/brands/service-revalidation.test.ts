import { describe, expect, it, vi } from "vitest";

import type { AuditContext } from "@/server/modules/audit-log/context";
import { createBrandService } from "@/server/modules/brands/service";
import type { BrandRepository } from "@/server/modules/brands/repository";

const BRAND_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const OWNER = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  role: "owner" as const,
};
const CONTEXT: AuditContext = { correlationId: "corr-1", ipHash: "hash" };

function fakeRepository(
  overrides: Partial<BrandRepository> = {},
): BrandRepository {
  return {
    list: vi.fn(),
    findById: vi.fn().mockResolvedValue({
      id: BRAND_ID,
      name: "Toyoat",
      slug: "toyoat",
      logoUrl: null,
      sortOrder: 0,
    }),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({
      id: BRAND_ID,
      name: "Toyota",
      slug: "toyota",
      logoUrl: null,
      sortOrder: 0,
    }),
    remove: vi.fn(),
    countVehicles: vi.fn().mockResolvedValue(0),
    propagateVehicleBrandName: vi.fn().mockResolvedValue(3),
    lock: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function serviceWith(
  repository: BrandRepository,
  extras: Partial<Parameters<typeof createBrandService>[0]> = {},
) {
  return createBrandService({
    repository,
    transaction: async (operation) =>
      operation({
        brands: repository,
        auditLog: { append: vi.fn().mockResolvedValue(undefined) } as never,
      }),
    ...extras,
  });
}

describe("brand rename catalogue revalidation", () => {
  it("revalidates the public catalogue after a rename propagates to vehicles", async () => {
    const revalidatePublicCatalogue = vi.fn();
    await serviceWith(fakeRepository(), { revalidatePublicCatalogue }).update(
      OWNER,
      BRAND_ID,
      { name: "Toyota" },
      CONTEXT,
    );
    expect(revalidatePublicCatalogue).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate when the rename affects no vehicles", async () => {
    const revalidatePublicCatalogue = vi.fn();
    await serviceWith(
      fakeRepository({
        propagateVehicleBrandName: vi.fn().mockResolvedValue(0),
      }),
      { revalidatePublicCatalogue },
    ).update(OWNER, BRAND_ID, { name: "Toyota" }, CONTEXT);
    expect(revalidatePublicCatalogue).not.toHaveBeenCalled();
  });

  it("does not revalidate when the name is unchanged (no-op rename)", async () => {
    const revalidatePublicCatalogue = vi.fn();
    const propagate = vi.fn().mockResolvedValue(3);
    await serviceWith(
      fakeRepository({
        findById: vi.fn().mockResolvedValue({
          id: BRAND_ID,
          name: "Toyota",
          slug: "toyota",
          logoUrl: null,
          sortOrder: 0,
        }),
        propagateVehicleBrandName: propagate,
      }),
      { revalidatePublicCatalogue },
    ).update(OWNER, BRAND_ID, { name: "Toyota" }, CONTEXT);
    expect(propagate).not.toHaveBeenCalled();
    expect(revalidatePublicCatalogue).not.toHaveBeenCalled();
  });

  it("reports a revalidation failure safely and still returns the committed rename", async () => {
    const reportCacheFailure = vi.fn();
    const dto = await serviceWith(fakeRepository(), {
      revalidatePublicCatalogue: vi.fn().mockRejectedValue(new Error("cache")),
      reportCacheFailure,
    }).update(OWNER, BRAND_ID, { name: "Toyota" }, CONTEXT);
    expect(dto.name).toBe("Toyota");
    expect(reportCacheFailure).toHaveBeenCalledWith(CONTEXT);
  });
});
