// Migration drift verification for Crown and Royal Rides.
//
// Prisma's schema language cannot express several reviewed raw-SQL constructs in
// the migrations (extensions, arbitrary CHECK constraints, STORED generated
// columns, GIN/pg_trgm indexes, a partial unique index, and a DEFERRABLE unique
// constraint), so a naive `migrate diff` is blind to them. This script therefore
// performs TWO complementary checks against a disposable scratch database —
// never the application database:
//
//   1. Prisma-representable parity: `migrate diff --from-migrations --to-schema
//      --exit-code` must report an empty diff. This catches any Prisma-level
//      schema change that is not reflected in the committed migrations.
//
//   2. Intentional-custom-SQL presence: replay the committed migrations into the
//      scratch database and assert, at the catalog level, that every reviewed
//      raw construct actually exists — so drift in the reviewed raw SQL cannot
//      pass unnoticed:
//        0001 — citext extension; business_settings_singleton_check;
//               inquiry_notification_emails NOT NULL.
//        0002 — pg_trgm extension; the STORED generated columns search_text /
//               search_vector; the GIN full-text and pg_trgm indexes; the five
//               vehicle sale/year CHECK constraints.
//        0003 — the partial one-cover-per-vehicle unique index; the DEFERRABLE
//               unique (vehicle_id, sort_order) constraint.
//        0004 — the three inquiry subject/type CHECK constraints.
//        0005 — rental/drivetrain enums; fourteen vehicle workflow CHECKs;
//               partial private-identifier unique indexes and featured index.
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

    // ── Phase 3 (0002–0004) reviewed raw SQL ────────────────────────────────

    // pg_trgm extension (0002), required by the trigram search index.
    const pgTrgm = await verifyClient.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    if (pgTrgm.rowCount !== 1) {
      fail("the pg_trgm extension is missing after replaying migrations.");
    }

    // The nine Phase 3 CHECK constraints (invisible to `migrate diff`).
    const EXPECTED_CHECKS = [
      "vehicles_sale_price_positive_check",
      "vehicles_sale_status_required_check",
      "vehicles_sale_price_required_check",
      "vehicles_sale_disabled_null_check",
      "vehicles_year_range_check",
      "inquiries_subject_exclusive_check",
      "inquiries_purchase_fields_check",
      "inquiries_viewing_fields_check",
      "vehicles_rental_daily_price_positive_check",
      "vehicles_rental_enabled_fields_check",
      "vehicles_rental_disabled_null_check",
      "vehicles_min_rental_days_range_check",
      "vehicles_mileage_km_range_check",
      "vehicles_engine_cc_range_check",
      "vehicles_seats_range_check",
      "vehicles_doors_range_check",
      "vehicles_driver_note_length_check",
      "vehicles_engine_description_length_check",
      "vehicles_exterior_color_length_check",
      "vehicles_interior_color_length_check",
      "vehicles_features_count_check",
      "vehicles_featured_consistency_check",
    ];
    const checks = await verifyClient.query(
      `SELECT conname FROM pg_constraint
       WHERE contype = 'c' AND conname = ANY($1::text[])`,
      [EXPECTED_CHECKS],
    );
    const foundChecks = new Set(checks.rows.map((row) => row.conname));
    const missingChecks = EXPECTED_CHECKS.filter(
      (name) => !foundChecks.has(name),
    );
    if (missingChecks.length > 0) {
      fail(`missing Phase 3 CHECK constraint(s): ${missingChecks.join(", ")}.`);
    }

    // STORED generated columns (0002): search_text and search_vector must both
    // be GENERATED ALWAYS, not plain columns.
    const generated = await verifyClient.query(
      `SELECT column_name, is_generated FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicles'
         AND column_name IN ('search_text', 'search_vector')`,
    );
    const generatedByName = new Map(
      generated.rows.map((row) => [row.column_name, row.is_generated]),
    );
    if (
      generatedByName.get("search_text") !== "ALWAYS" ||
      generatedByName.get("search_vector") !== "ALWAYS"
    ) {
      fail(
        "vehicles.search_text/search_vector are not both STORED generated columns.",
      );
    }

    // GIN full-text + pg_trgm indexes (0002).
    const searchIndexes = await verifyClient.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'vehicles'
         AND indexname IN ('vehicles_search_vector_idx', 'vehicles_search_text_trgm_idx')`,
    );
    const indexByName = new Map(
      searchIndexes.rows.map((row) => [row.indexname, row.indexdef]),
    );
    if (
      !/USING gin/i.test(indexByName.get("vehicles_search_vector_idx") ?? "")
    ) {
      fail("vehicles_search_vector_idx is missing or is not a GIN index.");
    }
    const trgmDef = indexByName.get("vehicles_search_text_trgm_idx") ?? "";
    if (!/USING gin/i.test(trgmDef) || !/gin_trgm_ops/i.test(trgmDef)) {
      fail(
        "vehicles_search_text_trgm_idx is missing or is not a GIN pg_trgm index.",
      );
    }

    // Partial one-cover-per-vehicle unique index (0003): unique + a WHERE
    // predicate on is_cover.
    const coverIndex = await verifyClient.query(
      `SELECT indexdef FROM pg_indexes
       WHERE indexname = 'vehicle_images_one_cover_per_vehicle_idx'`,
    );
    const coverDef = coverIndex.rows[0]?.indexdef ?? "";
    if (!/UNIQUE/i.test(coverDef) || !/WHERE .*is_cover/i.test(coverDef)) {
      fail(
        "the partial one-cover-per-vehicle unique index is missing or not partial.",
      );
    }

    // DEFERRABLE unique (vehicle_id, sort_order) constraint (0003).
    const deferrable = await verifyClient.query(
      `SELECT condeferrable FROM pg_constraint
       WHERE conname = 'vehicle_images_vehicle_id_sort_order_key' AND contype = 'u'`,
    );
    if (deferrable.rows[0]?.condeferrable !== true) {
      fail(
        "vehicle_images_vehicle_id_sort_order_key is missing or not DEFERRABLE.",
      );
    }

    const phase5Indexes = await verifyClient.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'vehicles' AND indexname = ANY($1::text[])`,
      [
        [
          "vehicles_registration_number_key",
          "vehicles_chassis_number_key",
          "vehicles_featured_at_idx",
        ],
      ],
    );
    const phase5IndexByName = new Map(
      phase5Indexes.rows.map((row) => [row.indexname, row.indexdef]),
    );
    for (const name of [
      "vehicles_registration_number_key",
      "vehicles_chassis_number_key",
    ]) {
      const definition = phase5IndexByName.get(name) ?? "";
      if (!/UNIQUE/i.test(definition) || !/WHERE/i.test(definition)) {
        fail(`${name} is missing, non-unique, or not partial.`);
      }
    }
    const featuredDefinition =
      phase5IndexByName.get("vehicles_featured_at_idx") ?? "";
    if (
      !/featured_at.*DESC/i.test(featuredDefinition) ||
      !/WHERE .*is_featured/i.test(featuredDefinition)
    ) {
      fail(
        "vehicles_featured_at_idx is missing or does not preserve the featured ordering/predicate.",
      );
    }
  } finally {
    await verifyClient.end();
  }
  console.log(
    "✓ Intentional raw SQL present (0001 citext/singleton/NOT NULL; 0002 pg_trgm,\n" +
      "  generated columns, GIN + pg_trgm indexes, sale/year CHECKs; 0003 partial\n" +
      "  cover index + DEFERRABLE ordering; 0004 inquiry subject/type CHECKs;\n" +
      "  0005 workflow CHECKs + partial identifier/featured indexes).",
  );
  console.log("✔ Migration drift check passed.");
}

main().catch((error) => {
  // Never surface a connection string; report only the error name/message text.
  const message = error instanceof Error ? error.message : String(error);
  fail(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"));
});
