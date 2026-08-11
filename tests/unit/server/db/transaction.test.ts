import { describe, expect, it, vi } from "vitest";

import {
  runInTransaction,
  type TransactionCallback,
  type TransactionCapableClient,
  type TransactionClient,
  type TransactionOptions,
} from "@/server/db/transaction";

/**
 * A typed fake standing in for a Prisma client's `$transaction`. It invokes the
 * callback with a sentinel transaction client and records the options it was
 * given, so the helper's contract can be proven without a real database.
 */
function createFakeClient(): {
  client: TransactionCapableClient;
  tx: TransactionClient;
  lastOptions: () => TransactionOptions | undefined;
} {
  const tx = { __brand: "transaction-client" } as unknown as TransactionClient;
  let seenOptions: TransactionOptions | undefined;

  const client: TransactionCapableClient = {
    $transaction<T>(
      fn: (client: TransactionClient) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> {
      seenOptions = options;
      return fn(tx);
    },
  };

  return { client, tx, lastOptions: () => seenOptions };
}

describe("runInTransaction", () => {
  it("passes the transaction client to the callback", async () => {
    const { client, tx } = createFakeClient();
    const callback = vi.fn<TransactionCallback<string>>(async () => "done");

    await runInTransaction(callback, undefined, client);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(tx);
  });

  it("returns the callback result", async () => {
    const { client } = createFakeClient();

    const result = await runInTransaction(
      async (tx) => {
        expect(tx).toBeDefined();
        return { id: 42 };
      },
      undefined,
      client,
    );

    expect(result).toEqual({ id: 42 });
  });

  it("propagates a thrown error so the transaction rolls back", async () => {
    const { client } = createFakeClient();
    const failure = new Error("callback failed");

    await expect(
      runInTransaction(
        async () => {
          throw failure;
        },
        undefined,
        client,
      ),
    ).rejects.toBe(failure);
  });

  it("forwards explicit transaction options unchanged", async () => {
    const { client, lastOptions } = createFakeClient();
    const options: TransactionOptions = {
      isolationLevel: "Serializable",
      maxWait: 1000,
      timeout: 8000,
    };

    await runInTransaction(async () => "ok", options, client);

    expect(lastOptions()).toEqual(options);
  });

  it("defaults options to undefined when none are given", async () => {
    const { client, lastOptions } = createFakeClient();

    await runInTransaction(async () => "ok", undefined, client);

    expect(lastOptions()).toBeUndefined();
  });
});
