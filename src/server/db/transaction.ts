import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Interactive-transaction helper.
 *
 * Prisma's interactive `$transaction(fn)` opens a transaction, passes a
 * transaction-scoped client to the callback, commits when the callback resolves
 * and rolls back when it rejects. This helper is a thin, typed wrapper around
 * that: it does not swallow errors, does not start nested transactions, and does
 * not expose any provider/connection details.
 *
 * The default isolation level is PostgreSQL's normal behaviour (Read Committed).
 * Individual operations that need stronger guarantees — e.g. "protect the last
 * owner" in later phases — pass an explicit `isolationLevel` rather than forcing
 * Serializable globally.
 */

/** The transaction-scoped Prisma client passed to a transaction callback. */
export type TransactionClient = Prisma.TransactionClient;

/** A unit of work executed inside a single interactive transaction. */
export type TransactionCallback<T> = (tx: TransactionClient) => Promise<T>;

/** Explicit, PostgreSQL-appropriate transaction options. */
export interface TransactionOptions {
  /** Overrides the default Read Committed isolation level when required. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Maximum time (ms) to wait to acquire a transaction from the pool. */
  maxWait?: number;
  /** Maximum time (ms) the interactive transaction may run before rollback. */
  timeout?: number;
}

/**
 * The minimal surface this helper needs from a Prisma client. Declaring it as an
 * interface lets tests inject a typed fake without constructing a real client.
 */
export interface TransactionCapableClient {
  $transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}

/**
 * Run `callback` inside a single interactive transaction and return its result.
 *
 * Errors thrown by the callback (or by the database) propagate unchanged so
 * Prisma rolls the transaction back. A Prisma-compatible client may be injected
 * for tests; by default the application singleton is used. The singleton is
 * imported lazily so this module stays free of import-time side effects.
 */
export async function runInTransaction<T>(
  callback: TransactionCallback<T>,
  options?: TransactionOptions,
  client?: TransactionCapableClient,
): Promise<T> {
  const executor: TransactionCapableClient =
    client ?? (await import("@/server/db/prisma")).prisma;
  return executor.$transaction(callback, options);
}
