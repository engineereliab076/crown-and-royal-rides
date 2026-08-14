import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { createPrismaAuditLogRepository } from "@/server/modules/audit-log/repository";
import { createPrismaBrandRepository } from "@/server/modules/brands/repository";
import { createBrandService } from "@/server/modules/brands/service";
import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();
function client(): PrismaClient {
  return suite.getClient();
}
const context = { correlationId: "brand-test", ipHash: "fake-ip-hash" };

async function actor() {
  return client().adminUser.create({
    data: {
      email: "owner@example.test",
      passwordHash: "not-a-real-hash",
      name: "Owner",
      role: "owner",
      mustChangePassword: false,
    },
    select: { id: true, role: true },
  });
}

function service(failAudit = false) {
  return createBrandService({
    repository: createPrismaBrandRepository(client()),
    suffix: () => "unique",
    transaction: async (operation, options) =>
      runInTransaction(
        async (tx) =>
          operation({
            brands: createPrismaBrandRepository(tx),
            auditLog: failAudit
              ? {
                  append: async () => {
                    throw new Error("forced audit failure");
                  },
                  list: async () => ({ items: [], nextCursor: null }),
                }
              : createPrismaAuditLogRepository(tx),
          }),
        options,
        client(),
      ),
  });
}

async function vehicle(brandId: string, brandName: string, slug: string) {
  return client().vehicle.create({
    data: {
      brandId,
      brandName,
      model: "Patrol",
      slug,
      year: 2020,
      bodyType: "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "diesel",
      driverOption: "without_driver",
    },
  });
}

describe("brand management", () => {
  it("renames a brand, propagates every vehicle, recomputes search, and audits atomically", async () => {
    const owner = await actor();
    const brand = await client().brand.create({
      data: { name: "Old Brand", slug: "old-brand", sortOrder: 1 },
    });
    const first = await vehicle(brand.id, brand.name, "old-brand-one");
    await vehicle(brand.id, brand.name, "old-brand-two");
    await service().update(owner, brand.id, { name: "New Brand" }, context);

    const related = await client().vehicle.findMany({
      where: { brandId: brand.id },
      select: { brandName: true },
    });
    expect(related).toEqual([
      { brandName: "New Brand" },
      { brandName: "New Brand" },
    ]);
    const search = await client().$queryRawUnsafe<
      Array<{ new_match: boolean; old_match: boolean }>
    >(
      `SELECT search_vector @@ plainto_tsquery('english', 'new') AS new_match,
              search_vector @@ plainto_tsquery('english', 'old') AS old_match
       FROM vehicles WHERE id = $1`,
      first.id,
    );
    expect(search[0]).toEqual({ new_match: true, old_match: false });
    expect(
      await client().adminAuditLog.count({
        where: { action: "brand.updated", targetId: brand.id },
      }),
    ).toBe(1);
  });

  it("rolls propagation back when the audit append fails", async () => {
    const owner = await actor();
    const brand = await client().brand.create({
      data: { name: "Stable Brand", slug: "stable-brand", sortOrder: 1 },
    });
    await vehicle(brand.id, brand.name, "stable-one");
    await expect(
      service(true).update(owner, brand.id, { name: "Broken Rename" }, context),
    ).rejects.toThrow("forced audit failure");
    expect(
      await client().brand.findUniqueOrThrow({ where: { id: brand.id } }),
    ).toMatchObject({ name: "Stable Brand" });
    expect(
      await client().vehicle.findFirstOrThrow({ where: { brandId: brand.id } }),
    ).toMatchObject({ brandName: "Stable Brand" });
  });

  it("blocks deletion while used and handles slug conflicts with a bounded suffix", async () => {
    const owner = await actor();
    const used = await client().brand.create({
      data: { name: "Used", slug: "used", sortOrder: 1 },
    });
    await vehicle(used.id, used.name, "used-one");
    await expect(
      service().remove(owner, used.id, context),
    ).rejects.toMatchObject({ status: 409, code: "BRAND_IN_USE" });

    await service().create(owner, { name: "A&B", sortOrder: 2 }, context);
    const second = await service().create(
      owner,
      { name: "A and B", sortOrder: 3 },
      context,
    );
    expect(second.slug).toBe("a-and-b-unique");
  });
});
