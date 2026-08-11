// Migration drift verification for Crown and Royal Rides.
//
// Prisma's schema language cannot express the two reviewed raw-SQL constructs in
// 0001_foundation (the `citext` extension and the `business_settings_singleton_
// check` CHECK constraint), so a naive `migrate diff` is blind to them. This
// script therefore performs TWO complementary checks against a disposable
// scratch database — never the application database:
//
//   1. Prisma-representable parity: `migrate diff --from-migrations --to-schema
//      --exit-code` must report an empty diff. This catches any Prisma-level
//      schema change that is not reflected in the committed migrations.
//
//   2. Intentional-custom-SQL presence: replay the committed migrations into the
//      scratch database and assert, at the catalog level, that citext and the
//      named CHECK constraint actually exist — so drift in the reviewed raw SQL
//      cannot pass unnoticed.
//
// A safe URL check refuses to run against anything that is not clearly a
// disposable test/scratch database. No URL, host, or credential is ever printed.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import pg from "pg";

const require = createRequire(import.meta.url);
const PRISMA_BIN = require.resolve("prisma/build/index.js");

const SHADOW_KEY = "SHADOW_DATABASE_URL";
const TEST_MARKER = /(test|scratch)/i;
const BLOCKED_HOST_FRAGMENTS = [
  "neon.tech",
  "pooler.",
  "rds.amazonaws.com",
  "supabase.co",
  "azure.com",
];
const BLOCKED_NAME_FRAGMENTS = ["prod", "production", "preview", "staging"];

function fail(message) {
  console.error(`✖ Migration drift check failed: ${message}`);
  process.exit(1);
}

function assertSafeScratchUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    fail(
      `${SHADOW_KEY} must be set to a disposable scratch/test database URL.`,
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${SHADOW_KEY} is not a valid URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail(`${SHADOW_KEY} must be a postgres:// URL.`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))) {
    fail(`${SHADOW_KEY} points at a managed/production-style host.`);
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (name === "") fail(`${SHADOW_KEY} must include a database name.`);
  const lower = name.toLowerCase();
  if (BLOCKED_NAME_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    fail(`${SHADOW_KEY} database name looks like a real environment.`);
  }
  if (!TEST_MARKER.test(name)) {
    fail(`${SHADOW_KEY} database name must contain "test" or "scratch".`);
  }
  return name;
}

function runPrisma(args, extraEnv) {
  try {
    execFileSync(process.execPath, [PRISMA_BIN, ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...extraEnv },
    });
    return 0;
  } catch (error) {
    return typeof error.status === "number" ? error.status : 1;
  }
}

async function main() {
  const shadowUrl = process.env[SHADOW_KEY];
  const databaseName = assertSafeScratchUrl(shadowUrl);
  console.log(
    `→ Verifying migration drift against scratch DB "${databaseName}".`,
  );

  // Check 1 — Prisma-representable parity. Exit codes: 0 empty, 1 error, 2 drift.
  const diffStatus = runPrisma(
    [
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    {},
  );
  if (diffStatus === 2) {
    fail(
      "committed migrations and prisma/schema.prisma have Prisma-representable drift.",
    );
  }
  if (diffStatus !== 0) {
    fail("`prisma migrate diff` did not complete successfully.");
  }
  console.log("✓ No Prisma-representable drift between migrations and schema.");

  // Check 2 — intentional custom SQL survives a fresh replay.
  const client = new pg.Client({ connectionString: shadowUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  const deployStatus = runPrisma(["migrate", "deploy"], {
    DATABASE_URL: shadowUrl,
    DIRECT_DATABASE_URL: shadowUrl,
    // Deploy targets the scratch DB directly; clear the shadow binding so
    // prisma.config.ts does not flag main == shadow.
    SHADOW_DATABASE_URL: "",
  });
  if (deployStatus !== 0) {
    fail("`prisma migrate deploy` failed against the scratch database.");
  }

  const verifyClient = new pg.Client({ connectionString: shadowUrl });
  await verifyClient.connect();
  try {
    const citext = await verifyClient.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'citext'",
    );
    if (citext.rowCount !== 1) {
      fail("the citext extension is missing after replaying migrations.");
    }
    const check = await verifyClient.query(
      `SELECT 1 FROM pg_constraint
       WHERE conname = 'business_settings_singleton_check' AND contype = 'c'`,
    );
    if (check.rowCount !== 1) {
      fail(
        "the business_settings_singleton_check constraint is missing after replaying migrations.",
      );
    }
    // Prisma renders a required String[] as a nullable column, so the NOT NULL
    // on inquiry_notification_emails is invisible to `migrate diff`. Assert it
    // at the catalog level so a regression to nullable cannot pass unnoticed.
    const notNull = await verifyClient.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'business_settings'
         AND column_name = 'inquiry_notification_emails'`,
    );
    if (notNull.rows[0]?.is_nullable !== "NO") {
      fail(
        "business_settings.inquiry_notification_emails is nullable but must be NOT NULL.",
      );
    }
  } finally {
    await verifyClient.end();
  }
  console.log(
    "✓ Intentional raw SQL present (citext + singleton check + inquiry_notification_emails NOT NULL).",
  );
  console.log("✔ Migration drift check passed.");
}

main().catch((error) => {
  // Never surface a connection string; report only the error name/message text.
  const message = error instanceof Error ? error.message : String(error);
  fail(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"));
});
