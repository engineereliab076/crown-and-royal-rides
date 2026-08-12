import path from "node:path";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the datasource connection URLs live here, not in
 * `schema.prisma`. Migration commands (migrate dev/deploy/status/diff) use the
 * DIRECT connection, so `datasource.url` is bound to `DIRECT_DATABASE_URL` — the
 * direct Neon connection, never the pooled runtime `DATABASE_URL`.
 *
 * The binding is guarded: when `DIRECT_DATABASE_URL` is absent (e.g. CI running
 * only offline commands such as `validate`, `generate`, or a `--from-empty`
 * schema diff), the datasource is simply omitted so those commands still work
 * without a database. The value is only ever handed to Prisma's own `env()`
 * resolver — it is never captured, printed, or logged here.
 *
 * `SHADOW_DATABASE_URL` is bound the same way. Prisma requires a shadow database
 * to replay a migrations directory in `prisma migrate diff --from-migrations`,
 * which the drift-verification script (`db:migrate:verify`) uses. It must point
 * at a disposable scratch/test database — never the application database.
 */
const hasEnv = (key: string): boolean =>
  typeof process.env[key] === "string" && process.env[key].length > 0;

const datasource = {
  ...(hasEnv("DIRECT_DATABASE_URL") ? { url: env("DIRECT_DATABASE_URL") } : {}),
  ...(hasEnv("SHADOW_DATABASE_URL")
    ? { shadowDatabaseUrl: env("SHADOW_DATABASE_URL") }
    : {}),
};

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // The seed reuses the production Argon2id helper, which is `server-only`.
    // `--conditions=react-server` resolves `server-only` to its empty variant so
    // the guarded module loads in this legitimately server-side Node context;
    // it never lowers the browser-bundle protection for the app itself.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  ...(Object.keys(datasource).length > 0 ? { datasource } : {}),
});
