import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Server-only Prisma singleton for the application runtime.
 *
 * The client is built on the `pg` driver adapter (`@prisma/adapter-pg`) and
 * bound to the **pooled** `DATABASE_URL` — never the direct migration URL, which
 * is reserved for `prisma migrate` commands (see `prisma.config.ts`). All
 * environment access goes through the validated `env` object so no arbitrary
 * `process.env` reads leak into the runtime, and no connection string is ever
 * logged here.
 *
 * Construction is lazy: importing this module has no side effects, so it is safe
 * to import from modules that are also loaded in non-runtime contexts (tests,
 * type checking). The real client — and therefore the pg pool — is created on
 * first use, and Prisma itself connects lazily on the first query. There is no
 * eager `$connect()`.
 *
 * Instance caching:
 *   - Outside production the resolved client is cached on `globalThis` so
 *     Next.js dev hot-reloads reuse one client (and one pool) instead of leaking
 *     a new connection pool on every reload.
 *   - In production a single module-scoped instance is created; no mutable
 *     database state is placed on `globalThis`.
 */

type PrismaGlobal = typeof globalThis & {
  crownAndRoyalRidesPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = env.DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error(
      "DATABASE_URL is not configured. The runtime database client requires " +
        "the pooled connection string.",
    );
  }

  // The pg driver adapter owns the pooled runtime connection. Prisma connects
  // lazily on first query; verbose query logging is intentionally left off.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let productionClient: PrismaClient | undefined;

function resolvePrismaClient(): PrismaClient {
  if (env.NODE_ENV === "production") {
    productionClient ??= createPrismaClient();
    return productionClient;
  }

  const globalForPrisma = globalThis as PrismaGlobal;
  globalForPrisma.crownAndRoyalRidesPrisma ??= createPrismaClient();
  return globalForPrisma.crownAndRoyalRidesPrisma;
}

/**
 * The canonical application Prisma client. Backed by a lazy proxy so the real
 * client is constructed on first property access rather than at import time.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolvePrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
