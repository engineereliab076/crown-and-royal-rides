import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";

import { setupDatabaseSuite } from "../support/lifecycle";

/**
 * Proves the interactive transaction helper against the real test database:
 * successful multi-write commit, rollback on error, and error propagation. The
 * verified test client is injected into the helper so the app singleton is not
 * touched.
 */

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

describe("runInTransaction against PostgreSQL", () => {
  it("commits two writes in a single transaction", async () => {
    await runInTransaction(
      async (tx) => {
        await tx.brand.create({
          data: { name: "Tx Brand", slug: "tx-brand", sortOrder: 1 },
        });
        await tx.mediaDeletionQueue.create({
          data: { publicId: "tx/asset", ownerType: "brand" },
        });
      },
      undefined,
      client(),
    );

    expect(await client().brand.count()).toBe(1);
    expect(await client().mediaDeletionQueue.count()).toBe(1);
  });

  it("rolls back every write when the callback throws", async () => {
    const failure = new Error("deliberate rollback");

    await expect(
      runInTransaction(
        async (tx) => {
          await tx.brand.create({
            data: {
              name: "Rollback Brand",
              slug: "rollback-brand",
              sortOrder: 1,
            },
          });
          throw failure;
        },
        undefined,
        client(),
      ),
    ).rejects.toBe(failure);

    expect(await client().brand.count()).toBe(0);
  });

  it("supports an explicit isolation level", async () => {
    const created = await runInTransaction(
      async (tx) => {
        return tx.brand.create({
          data: { name: "Serial Brand", slug: "serial-brand", sortOrder: 1 },
        });
      },
      { isolationLevel: "Serializable" },
      client(),
    );

    expect(created.slug).toBe("serial-brand");
    expect(await client().brand.count()).toBe(1);
  });
});
