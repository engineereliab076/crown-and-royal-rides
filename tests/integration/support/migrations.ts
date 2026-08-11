import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TestDatabaseConfig } from "./test-database-env";

/**
 * Migration control for the integration harness.
 *
 * Migrations are applied with the committed `prisma migrate deploy` — never
 * `db push` and never `migrate reset` — against the DIRECT test URL. Output that
 * could contain a connection string is redacted before it ever surfaces.
 */

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
const PRISMA_BIN = requireFromHere.resolve("prisma/build/index.js");

const POSTGRES_URL_PATTERN = /postgres(?:ql)?:\/\/\S+/gi;

function redactConnectionStrings(text: string): string {
  return text.replace(POSTGRES_URL_PATTERN, "postgres://[redacted]");
}

interface ExecFailure {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function isExecFailure(value: unknown): value is ExecFailure {
  return typeof value === "object" && value !== null;
}

/**
 * Apply committed migrations to the test database using the DIRECT test URL.
 * The child process's datasource is bound to the test URL only; the surrounding
 * application env is never used for migration.
 */
export async function runMigrateDeploy(
  config: TestDatabaseConfig,
): Promise<void> {
  try {
    await execFileAsync(process.execPath, [PRISMA_BIN, "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // prisma.config.ts binds the migration datasource to
        // DIRECT_DATABASE_URL; point both at the verified test URL so no
        // application connection can be selected.
        DATABASE_URL: config.directUrl,
        DIRECT_DATABASE_URL: config.directUrl,
      },
    });
  } catch (error: unknown) {
    const detail = isExecFailure(error)
      ? redactConnectionStrings(
          `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
        )
      : "";
    const code = isExecFailure(error) ? error.code : undefined;
    throw new Error(
      `prisma migrate deploy failed (exit ${String(code ?? "unknown")}).` +
        (detail ? `\n${detail}` : ""),
    );
  }
}

let deployOnce: Promise<void> | undefined;

/**
 * Apply migrations at most once per test process. `migrate deploy` is
 * idempotent, so repeated calls after the first are no-ops.
 */
export function ensureMigrationsDeployed(
  config: TestDatabaseConfig,
): Promise<void> {
  deployOnce ??= runMigrateDeploy(config);
  return deployOnce;
}

/**
 * Drop and recreate the `public` schema so the next `migrate deploy` runs
 * against a genuinely empty database (no tables, no `_prisma_migrations`, no
 * `citext`). Both statements are constants — no interpolation — and only ever
 * run after the safety gate has verified the target is a disposable test DB.
 */
export async function resetPublicSchema(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await client.$executeRawUnsafe("CREATE SCHEMA public");
}
