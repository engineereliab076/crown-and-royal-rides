# Crown and Royal Rides — Runbook

Operational runbook for the Crown and Royal Rides web application. This file is
committed documentation and must never contain real secrets, tokens, connection
strings, IP addresses, or internal cloud identifiers.

## Project foundation

| Component            | Version / target                                  |
| -------------------- | ------------------------------------------------- |
| Next.js              | 15.5.22 (App Router)                              |
| React                | 19.1.0                                            |
| TypeScript           | strict (`strict`, `noUncheckedIndexedAccess`)     |
| pnpm                 | 11.9.0                                            |
| Node (CI target)     | 22                                                |
| Node (local Phase 0) | 26.2.0                                            |
| Database             | PostgreSQL 16                                     |
| Unit/integration     | Vitest 4                                          |
| End-to-end           | Playwright (Desktop Chromium, Pixel 5, iPhone 13) |
| Hosting              | Vercel (GitHub-connected; Production Ready)       |
| Version control / CI | GitHub repository + GitHub Actions (remote CI)    |
| Managed database     | Neon (AWS Frankfurt, `eu-central-1`)              |

Build pipeline is Webpack production build:

- `dev`: `next dev --turbopack`
- `build`: `next build`
- `start`: `next start`

## Local setup

1. Install dependencies (exact, reproducible):

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Copy the example environment file to an ignored local file only when you need
   real local values:

   ```bash
   cp .env.example .env.local
   ```

3. Never commit `.env` or `.env.local`. Only `.env.example` is committed and it
   must never hold real secrets.

4. Local PostgreSQL via Docker Compose:

   ```bash
   docker compose -f compose.yaml config --quiet   # validate configuration
   docker compose -f compose.yaml up -d postgres    # start PostgreSQL 16
   docker compose -f compose.yaml ps                # check status/health
   docker compose -f compose.yaml stop              # stop WITHOUT deleting data
   ```

5. Port conflict procedure: if host port 5432 is already occupied (for example
   by a native PostgreSQL install), do not fight the running service.

6. To use a different host port, set `POSTGRES_PORT` (for example `5433`) before
   `up`, and update both `DATABASE_URL` and `DIRECT_DATABASE_URL` in your local
   env file to the same port:

   ```bash
   POSTGRES_PORT=5433 docker compose -f compose.yaml up -d postgres
   ```

7. Never run `docker compose down -v` casually — the `-v` flag deletes the
   `postgres_data` volume and all local data. Use `stop` to pause the service.

Do not document real production credentials anywhere in this repository.

## Development commands

| Task                       | Command                  |
| -------------------------- | ------------------------ |
| Dev server                 | `pnpm dev`               |
| Format check               | `pnpm format:check`      |
| Type check                 | `pnpm typecheck`         |
| Lint                       | `pnpm lint`              |
| Unit tests                 | `pnpm test:unit`         |
| Database integration tests | `pnpm test:integration`  |
| All Vitest tests           | `pnpm test`              |
| Verify migration drift     | `pnpm db:migrate:verify` |
| Run guarded seed skeleton  | `pnpm db:seed`           |
| Production build           | `pnpm build`             |
| Production start           | `pnpm start`             |
| End-to-end (dev server)    | `pnpm test:e2e`          |
| End-to-end (CI/prod path)  | `CI=true pnpm test:e2e`  |

`CI=true` makes Playwright build-and-`next start` instead of using the dev
server, so always run `pnpm build` first (the CI workflow does this for you).

`pnpm test:integration` and `pnpm test` (which includes it) require a disposable
test database and the `TEST_*` / `ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS`
variables — see "Database runtime and integration tests". `pnpm test:unit` never
needs PostgreSQL and is what the CI `quality` job runs.

## Architecture boundaries

- Business modules depend on application-owned, provider-neutral interfaces,
  never directly on a provider SDK. The current contracts live under
  `src/server/integrations/` for media storage, email delivery, rate limiting,
  and error reporting.
- Provider SDKs (Cloudinary, Resend, Upstash, Sentry) may be imported **only**
  from `src/server/integrations/`. This is enforced by ESLint
  (`no-restricted-imports`) for `src/server/modules/**`, `src/components/**`,
  and `src/app/**`.
- Deterministic in-memory adapters are the default test doubles. Tests must not
  contact a real provider unless a future provider-specific test is explicitly
  configured to do so.
- `src/server/integrations/container.ts` is the only adapter-selection and
  composition location. Business modules must never choose providers.
- `ErrorReporter` has one canonical contract under
  `src/server/integrations/error-reporter/`; the legacy HTTP reporter module is
  only a compatibility re-export.
- BigInt values must not leave service DTOs; convert at the service boundary.
- All money is stored and handled as whole TZS (no minor units, no floats).
- Phone numbers are stored in E.164 format.
- All date/time decisions use the `Africa/Dar_es_Salaam` timezone.
- HTTP handlers attach correlation IDs and return safe response envelopes.
- Secrets are never committed to the repository.

## Real provider adapters and composition

The provider-neutral contracts, deterministic doubles, and real adapters are
co-located below `src/server/integrations/`:

| Capability      | Real adapter location                        |
| --------------- | -------------------------------------------- |
| Media storage   | `media-storage/cloudinary.ts`                |
| Email delivery  | `email-sender/resend.ts`                     |
| Rate limiting   | `rate-limiter/upstash.ts`                    |
| Error reporting | `error-reporter/sentry.ts`                   |
| Selection       | `container.ts` (the single composition root) |

Adapter selection is deliberately centralized and inspectable through a safe
mode descriptor that contains provider names only, never credentials:

- `NODE_ENV=test` always selects all four in-memory adapters. Provider clients
  are not constructed and ordinary unit tests make no live provider calls.
- Local development selects a real adapter only when that provider's complete
  validated environment group is present. A wholly absent group selects its
  in-memory sibling. Partial groups fail environment validation.
- Vercel Preview and Production require all four complete runtime groups and
  fail safely with missing variable names if any group is absent. A local
  `NODE_ENV=production` build without a deployed `VERCEL_ENV` remains local and
  does not get mistaken for a deployed Production runtime.

All provider credentials remain server-side. `NEXT_PUBLIC_SENTRY_DSN` is public
by design; no other provider secret may use `NEXT_PUBLIC_`. `SENTRY_AUTH_TOKEN`
is build/CI-only and is never read by runtime initialization. The minimal
server-side Sentry setup is in `instrumentation.ts` and
`sentry.server.config.ts`; it disables personal-data collection by default and
sets tracing to zero. Session Replay is not enabled.

Provider-specific operational rules:

- Cloudinary upload-request signing and upload-response verification are
  different operations. Requests are signed over constrained upload parameters;
  responses are independently verified over `public_id` and `version` before a
  neutral asset is accepted. Only reviewed image formats and the configured
  environment folder namespace are allowed. Deletes invalidate the CDN and are
  idempotent.
- Resend requires the configured sender domain to be verified before real email
  delivery will succeed. The adapter returns safe accepted/failed outcomes and
  never exposes email contents, recipients, API errors, or credentials.
- Upstash Redis is used only for fixed-window rate limiting—never caching,
  sessions, queues, or application data. Analytics is disabled. A bounded
  process cache reuses limiter instances by namespace, limit, and exact
  millisecond window.
- Sentry receives a correlation tag and sanitized route/method/additional
  context in an isolated scope. Query strings, credentials, request bodies,
  inquiry contents, and other personal data are excluded. Actor IDs are off by
  default and require an explicit adapter policy decision.

Real-adapter tests inject narrow fake SDK facades. They never send email, upload
or delete media, write Redis, or emit Sentry events. Live-provider smoke tests
are not part of the ordinary unit suite.

### Guarded seed skeleton

Prisma 7 invokes `prisma/seed.ts` explicitly through `pnpm db:seed`; it is not
run automatically by migration commands. Treat seeding as a one-off
administrative operation: the skeleton deliberately uses `DIRECT_DATABASE_URL`,
not the pooled runtime URL, and refuses `VERCEL_ENV=production` before client
construction. A complete `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` pair is also
required, and the password is never printed or stored in plaintext.

The Phase 1 skeleton currently exits non-zero without issuing a database query
or mutation because the Phase 2 Argon2id password-hashing service does not yet
exist. This prevents an owner account from being created with a placeholder or
plaintext password. Once Phase 2 supplies that service, owner creation can be
implemented at the marked guard while retaining the production gate, validated
configuration, direct-connection policy, and `finally` disconnect.

## Database migrations

Prisma ORM 7 with the `pg` driver adapter. The schema lives in
`prisma/schema.prisma`; the Prisma 7 configuration (schema location, migrations
directory, and the migration datasource binding) lives in `prisma.config.ts`.
Generated Prisma Client is written to `src/generated/prisma` and is **not**
committed — it is regenerated on every install (`postinstall`) and on Vercel
builds, and is git-ignored.

**Ownership and phasing.** Migrations are feature-owned: each feature brings its
own migration when it is built.

- Phase 1 (this migration, `0001_foundation`) creates only the genuinely shared
  foundation tables and enums: `admin_users`, `admin_audit_log`, `brands`,
  `business_settings`, `media_deletion_queue`, plus the `admin_role` and
  `listing_state` enums. `listing_state` is created now because later feature
  tables share it.
- Vehicles arrive in Phase 3.
- Inquiry request fields arrive in Phase 8.
- Rental packages arrive in Phase 9.

**Working with migrations during development.**

- Keep migrations incremental and reviewable. Each is a small, readable step.
- Do **not** squash migration history during active development. A single
  squashed `init` migration is permitted only once, immediately before the first
  production deployment, after the schema has stopped moving.
- `DATABASE_URL` is the pooled runtime/application connection used by the app.
- `DIRECT_DATABASE_URL` is the direct connection used by all migration commands
  (bound in `prisma.config.ts`). Migrations must never run over the pooler.
- The Neon roles are separate:
  - **Migration role** — has schema-changing privileges; used only by controlled
    migration commands and CI deployment.
  - **Application role** — normal runtime DML only; no schema ownership or
    migration privileges.
- Never run `migrate dev`, `db push`, or `migrate reset` against Production.
  (There is deliberately no `db:push` or reset script in `package.json`.)
- Production applies committed migrations through `prisma migrate deploy`
  (`pnpm db:migrate:deploy`) using the migration role.

**Migration scripts** (`package.json`):

| Task                                 | Command                  |
| ------------------------------------ | ------------------------ |
| Generate Prisma Client               | `pnpm db:generate`       |
| Create/apply a dev migration         | `pnpm db:migrate:dev`    |
| Apply committed migrations (deploy)  | `pnpm db:migrate:deploy` |
| Show migration status                | `pnpm db:migrate:status` |
| Diff committed migrations vs. schema | `pnpm db:migrate:diff`   |
| Verify migration drift               | `pnpm db:migrate:verify` |
| Prisma Studio                        | `pnpm db:studio`         |

To check migration status safely against a real database, set the direct URL for
the command only (never commit it) and run `pnpm db:migrate:status`. Status is
read-only — it never mutates the schema. Never point `migrate:dev`/`deploy` at a
database whose purpose you cannot prove.

### Raw-SQL migration review checklist

Some constructs cannot be expressed in `schema.prisma` (extensions, arbitrary
CHECK constraints, partial/expression indexes, generated columns). When a
migration contains raw SQL, review every custom construct against this list:

- Is the custom SQL genuinely required (not expressible in the schema)?
- Does it have a stable, explicit name?
- Is it in the correct feature-owned migration?
- Does the migration apply cleanly from an empty database?
- Is rollback/recovery impact documented where it matters?
- Is the invariant proven by a failing-insert test? (Constraint integration
  tests are owned by Group 2's scratch-database harness.)
- Does Prisma introspection preserve or erase the construct? (A hand-written
  CHECK is not represented back in `schema.prisma`; keep it in the migration.)
- Does a schema diff report unexpected drift?
- Are indexes duplicated by primary keys or unique constraints? (PostgreSQL
  auto-indexes both — do not add redundant single-column indexes over them.)
- Are `ON DELETE` and `ON UPDATE` behaviors intentional?
- For CHECK constraints: are `NULL` semantics understood? (A CHECK passes when
  it evaluates to NULL; ensure referenced columns are NOT NULL if that matters.)
- For partial unique indexes: is the predicate exact and documented?
- For deferrable unique constraints: is transaction-time behavior tested?
- For generated columns: is the expression immutable and reproducible?
- Was the raw SQL edited **before** the migration was first applied anywhere
  (never edit an already-applied migration)?

Current Prisma can represent some partial indexes directly in the schema, but
this checklist still applies to every custom or advanced database construct,
however it is authored.

## Database runtime and integration tests

### Application database client

The runtime Prisma client is a server-only singleton at `src/server/db/prisma.ts`,
built on the `pg` driver adapter and bound to the **pooled** `DATABASE_URL`
(never `DIRECT_DATABASE_URL`, which is migration-only). It is constructed lazily
(no eager `$connect()`), cached on `globalThis` outside production to survive dev
hot-reloads, and never logs a connection string. The interactive transaction
helper is `src/server/db/transaction.ts` (`runInTransaction`), which defaults to
Read Committed and lets specific operations opt into a stronger isolation level.

### Why application and test URLs are separate

Database integration tests are **destructive by design**: they create, truncate,
drop, and recreate schema objects. They therefore run only against a dedicated,
disposable test database identified by separate variables — never the
application's `DATABASE_URL`/`DIRECT_DATABASE_URL`:

| Variable                                     | Purpose                                 |
| -------------------------------------------- | --------------------------------------- |
| `TEST_DATABASE_URL`                          | Pooled URL for the test Prisma client   |
| `TEST_DIRECT_DATABASE_URL`                   | Direct URL for `migrate deploy`         |
| `ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS` | Must equal `true` to permit destruction |
| `SHADOW_DATABASE_URL`                        | Disposable scratch DB for drift verify  |

These keys are **not** part of the 26 application environment keys, are never
`NEXT_PUBLIC_`, and are not added to `.env.example`. They are supplied ad hoc for
a test run (locally) or scoped to the CI database job. The safety gate lives at
`tests/integration/support/test-database-env.ts` and refuses to run unless:

1. `TEST_DATABASE_URL` and `TEST_DIRECT_DATABASE_URL` are present and are valid
   `postgres://` URLs with a non-empty database name.
2. The database name contains a clear disposable marker (`test` or `scratch`).
3. The name does not look like a real environment (`prod`, `preview`, `staging`).
4. The host is not a managed provider (e.g. `*.neon.tech`).
5. `ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true` is set. This acknowledgement
   is a **second** guard, never a substitute for a correctly named database —
   both must pass. Safety errors never include the URL, host, or credentials.

**Production and preview databases must never be used for integration tests.**
The gate rejects Neon-style hosts and any non-test database name, and the harness
never imports the application `prisma` singleton in destructive setup.

### Configuring a local test database

Reuse the existing Docker Compose PostgreSQL 16 (see Local setup) and create a
separate, clearly-named test database inside it — leaving the development
database untouched. For example, with the running Compose service:

```bash
# Create a disposable test database (local, throwaway credentials only).
docker compose -f compose.yaml exec -T postgres createdb -U "$PGUSER" crown_royal_rides_test
```

Then run the tests with the test URLs exported for that command only (never
commit them). The database name must contain `test` or `scratch`:

```bash
export TEST_DATABASE_URL="postgresql://USER:PW@localhost:PORT/crown_royal_rides_test?schema=public"
export TEST_DIRECT_DATABASE_URL="$TEST_DATABASE_URL"
export ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true
pnpm test:integration        # migration deploy + constraint + transaction tests
```

Migration verification uses a scratch database and its own variable:

```bash
export SHADOW_DATABASE_URL="postgresql://USER:PW@localhost:PORT/crown_royal_rides_scratch?schema=public"
pnpm db:migrate:verify
```

`db:migrate:verify` performs two complementary checks against the scratch DB and
never touches the application database:

1. **Prisma-representable parity** — `migrate diff --from-migrations --to-schema
--exit-code` must report an empty diff.
2. **Intentional raw SQL presence** — after replaying migrations it asserts the
   `citext` extension and the `business_settings_singleton_check` constraint
   exist, so drift in the reviewed custom SQL (which Prisma's diff cannot see)
   cannot pass unnoticed.

### Harness behavior

- Migrations are applied with committed `prisma migrate deploy` (never `db push`,
  never `migrate reset`) using `TEST_DIRECT_DATABASE_URL`.
- The migration test resets the `public` schema first so its "started empty"
  assertions are real, then proves exactly the five foundation tables, the two
  enums, and `citext` exist.
- Between tests, exactly one guarded `TRUNCATE ... RESTART IDENTITY CASCADE` runs
  over a fixed allowlist — `admin_audit_log`, `business_settings`,
  `media_deletion_queue`, `brands`, `admin_users` — so migration history
  (`_prisma_migrations`) is preserved. No table is discovered dynamically.
- The integration Vitest project runs single-worker and non-parallel so
  destructive cleanup is deterministic; the test client disconnects after the
  suite.

### How CI provides PostgreSQL

CI runs a dedicated `db-integration` job (after `quality`) with a
`postgres:16-alpine` service container using clearly fake, CI-only credentials
and a `*_test` database name, plus a `pg_isready` health check. The `TEST_*` and
`ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS` variables are scoped to that job
only. The `quality` job runs `pnpm test:unit` (no PostgreSQL) and the browser
`e2e` job does not depend on PostgreSQL, matching the current static app. Neon is
never used for CI integration tests, and no Cloudinary/Resend/Upstash/Sentry/Auth
credentials are required.

### Recovering when integration setup fails

- **Safety gate refuses to run**: the message lists the failed guard (missing
  variable, missing marker, blocked host/name, or missing acknowledgement). Fix
  the `TEST_*` variables — do not weaken the gate.
- **`migrate deploy` fails**: confirm the container is healthy
  (`docker compose -f compose.yaml ps`) and the test database exists. Re-create
  it with `createdb` if needed; the migration test rebuilds the schema itself.
- **Left-over state**: the harness truncates before each test and the migration
  test rebuilds `public`. To reset manually, drop and recreate the test
  database — never the development or production database.
- **No server or container should remain** after a run; the harness starts no
  long-lived process, and the Compose volume is preserved (`stop`, never
  `down -v`).

**What `0001_foundation` adds by hand** (reviewed): `CREATE EXTENSION IF NOT
EXISTS citext` before the CITEXT `admin_users.email` column; the named single-row
CHECK `business_settings_singleton_check` (`id = 1`) that keeps
`business_settings` to exactly one row (its `id` is the NOT NULL primary key, so
the CHECK can never evaluate to NULL); and `NOT NULL` on
`business_settings.inquiry_notification_emails`. Prisma renders a required
`String[]` as a **nullable** column, so the list would otherwise permit `NULL`
via raw SQL. The intended invariant is that the list is always present — an empty
array `[]` means "no recipients" and `NULL` is forbidden; the single settings row
supplies the list explicitly (no column default). Because Prisma's schema diff
does not represent scalar-list nullability, `db:migrate:verify` asserts this
`NOT NULL` at the catalog level alongside citext and the CHECK.

**Correcting `0001` before first shared deployment.** `0001_foundation` has only
ever been applied to disposable local test/scratch databases — never Production
or Preview — so the `NOT NULL` fix above was made **in place** in the original
migration rather than as a second migration. This is the last permitted in-place
edit to `0001`: once it reaches any shared environment it is frozen, and every
later change must arrive as a new, additive migration.

## Environment variables

- `.env.example` is the authoritative documentation of every supported key
  (26 keys, matching `KNOWN_KEYS` in `src/lib/env.schema.ts`).
- Optional provider groups are all-or-none: setting any member of a group makes
  the whole group required.
- Preview and Production application URLs must use HTTPS.
- `AUTH_SECRET`, `IP_HASH_SECRET`, and `CRON_SECRET` must each be generated
  independently (≥ 32 chars) and never reused across each other.
- Vercel Preview and Production environment scopes are kept separate.
- This file records variable **names and scopes only** — never actual values.

Phase 0 uses only four deployment variables (see Cloud resources). Auth,
Cloudinary, Resend, Upstash, Sentry, cron, and seed groups are intentionally
left unset because the current application is static.

## Region benchmark

The benchmark was run from the developer's current Tanzanian connection, not
from a cloud runner. It is a **regional network-path benchmark** (HTTPS timing
to region-specific AWS endpoints), not a direct database-query benchmark.

**Conditions**

| Field            | Value                                       |
| ---------------- | ------------------------------------------- |
| Date / time      | 2026-08-10 01:18 EAT (2026-08-09 22:18 UTC) |
| Timezone         | Africa/Dar_es_Salaam (UTC+3)                |
| Connection type  | Mobile hotspot                              |
| VPN / proxy      | None                                        |
| ISP              | Not recorded (by choice)                    |
| Samples / region | 15 measured, sequential                     |
| Warm-up          | 1 discarded warm-up request per region      |
| Concurrency      | None (regions measured one at a time)       |

**Method**: `curl.exe` HTTPS requests to `https://s3.<region>.amazonaws.com`
(same endpoint family and method for every region), capturing TCP connect, TLS
handshake, time-to-first-byte, and total time. 3xx/4xx responses are acceptable
— they prove the regional endpoint was reached. No credentials or signed
requests were sent. Raw samples were stored in a temporary directory outside the
repository and discarded.

**Results (total round-trip, milliseconds)**

| Neon region                  | Samples | Failures | Median | p95   | Min   | Max   | Median connect | Median TLS | Median TTFB |
| ---------------------------- | ------- | -------- | ------ | ----- | ----- | ----- | -------------- | ---------- | ----------- |
| Frankfurt (`eu-central-1`)   | 15      | 0        | 714.4  | 814.0 | 693.2 | 814.0 | 249.4          | 490.0      | 714.3       |
| London (`eu-west-2`)         | 15      | 0        | 722.9  | 935.2 | 689.5 | 935.2 | 245.3          | 487.7      | 722.9       |
| Singapore (`ap-southeast-1`) | 15      | 0        | 827.8  | 906.1 | 790.4 | 906.1 | 281.0          | 562.2      | 827.8       |

**Chosen Neon region: AWS Frankfurt (`eu-central-1`).** All candidates had zero
failures; Frankfurt had the lowest median and the lowest p95, and it aligns with
the planned Vercel function region.

**Actual Neon query benchmark**: not performed. Only the regional network-path
benchmark above was completed. A live `SELECT 1` benchmark was deliberately
skipped so that no Neon connection string had to be read back, printed, or
stored. The chosen region stands on the network-path evidence.

**Limitations**: measured over a mobile hotspot on a single day; absolute values
reflect that access network. The AWS HTTPS path is a proxy for network distance,
not a Neon query measurement. Relative ordering (Frankfurt ≈ London < Singapore)
is the actionable result.

**Planned Vercel function region: `fra1` (Frankfurt).** Rationale: static pages
and assets are served from Vercel's global edge network, but future server
functions should run close to the database. With Neon in Frankfurt, `fra1`
minimizes application-to-database latency for the first dynamic route. This is
recorded as the planned default; no function-region config is added to the
static Phase 0 application.

## Cloud resources

Recorded names and scopes only — no internal IDs, connection strings, or tokens.

| Resource                    | Value                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| Neon project (human name)   | crown-and-royal-rides                                                      |
| Neon PostgreSQL version     | 16                                                                         |
| Neon region                 | AWS Frankfurt (`eu-central-1`)                                             |
| Vercel project (human name) | crown-and-royal-rides (connected to the GitHub repository)                 |
| Production branch           | `main`                                                                     |
| Production deployment       | Ready                                                                      |
| Public production URL       | https://crown-and-royal-rides.vercel.app                                   |
| Vercel env vars set         | `NEXT_PUBLIC_APP_URL`, `APP_ORIGIN`, `DATABASE_URL`, `DIRECT_DATABASE_URL` |

`NEXT_PUBLIC_APP_URL` and `APP_ORIGIN` use the public Vercel origin;
`DATABASE_URL` holds the Neon pooled connection and `DIRECT_DATABASE_URL` the
Neon direct connection. Values are stored only in Vercel/Neon and never appear
here.

Not set (unused by the static app): `AUTH_URL`, `AUTH_SECRET`,
`IP_HASH_SECRET`, `CRON_SECRET`, `SEED_OWNER_*`, `SENTRY_AUTH_TOKEN`, and the
Cloudinary / Resend / Upstash / Sentry runtime groups. Vercel's system variables
(`VERCEL_ENV`, `NODE_ENV`) are managed by Vercel and not set manually.

## Deployment

Deployments are driven by the GitHub-connected Vercel project. No local
`vercel deploy` is required for normal operation.

- **Production**: pushing to the `main` branch triggers an automatic Vercel
  Production deployment. Current Production status is **Ready** at
  https://crown-and-royal-rides.vercel.app.
- **Preview**: pull requests and non-`main` branches produce automatic Vercel
  Preview deployments with their own generated `*.vercel.app` URLs.
- Environment variables are managed in the Vercel dashboard
  (Project → Settings → Environment Variables), scoped per environment, so
  secrets never enter terminal history or the repository.
- Source changes are always authored locally in VS Code and reach Vercel only
  through GitHub. Generated `*.vercel.app` URLs are public and non-secret.

## CI status

- `.github/workflows/ci.yml` exists locally and defines three jobs:
  - `quality`: install (frozen) → format check → typecheck → lint → unit tests →
    build.
  - `db-integration` (after `quality`): PostgreSQL 16 service container →
    install → generate Prisma Client → database integration tests → migration
    drift verification.
  - `e2e`: install → Playwright browsers → build → end-to-end tests.
- All local equivalents of these steps pass (see Phase 0 verification).
- **Remote CI is verified.** GitHub Actions has executed remotely and both jobs
  passed: `quality` ✓ and `e2e` ✓.
- GitHub is used only for version control, CI, and Vercel deployment. All source
  changes are authored locally in VS Code and pushed to GitHub for those
  purposes.

## Phase 0 verification

Dated results — **2026-08-10** (local Node 26.2.0, pnpm 11.9.0):

| Check                              | Result                                           |
| ---------------------------------- | ------------------------------------------------ |
| `pnpm install --frozen-lockfile`   | Pass (lockfile up to date)                       |
| `pnpm format:check`                | Pass                                             |
| `pnpm typecheck`                   | Pass                                             |
| `pnpm lint`                        | Pass                                             |
| Unit tests                         | 394 passed                                       |
| Integration tests                  | Empty (intentional, `--passWithNoTests`)         |
| `pnpm test` (all Vitest)           | 394 passed                                       |
| `pnpm build`                       | Pass                                             |
| E2E (dev path)                     | 27 passed                                        |
| E2E (`CI=true`, `next start` path) | 27 passed                                        |
| Boundary-lint negative test        | Fails as expected (`no-restricted-imports`)      |
| Environment key audit              | 26 keys, exact set equality                      |
| Secret scan                        | Clean (only test placeholders)                   |
| Vercel Production deployment       | Ready (https://crown-and-royal-rides.vercel.app) |
| Remote CI — `quality` job          | Passed                                           |
| Remote CI — `e2e` job              | Passed                                           |
| Docker (static compose validation) | Valid                                            |
| Docker (runtime)                   | Blocked — daemon not running                     |

## Troubleshooting

- **Port 3000 occupied**: stop the other process or run the dev server on
  another port (`PORT=3001 pnpm dev`).
- **Port 5432 occupied**: a native PostgreSQL or another container holds the
  port. Use `POSTGRES_PORT=5433` and update both database URLs (see Local setup).
- **Docker daemon stopped**: start Docker Desktop and wait for it to report
  running before `docker compose up`. `docker compose config` validates the file
  without the daemon, but `up`/`ps` require it.
- **`next start` fails / `routesManifest.dataRoutes is not iterable`**: the
  `.next` output is a dev build. Run `pnpm build` before `pnpm start` or
  `CI=true pnpm test:e2e`.
- **Playwright browser binaries missing**: `pnpm exec playwright install`
  (add `--with-deps` on Linux/CI).
- **Environment validation failure**: read the `EnvironmentValidationError`
  issue list (key + reason). Common causes: non-HTTPS URL in preview/production,
  a partially-filled all-or-none group, or a secret shorter than 32 chars.
- **Preview alias mismatch**: after a new deployment the alias must be re-pointed
  with `vercel alias set <deployment-url> <preview-alias>`; otherwise the alias
  still serves the previous deployment.
- **Accidental secret exposure**: rotate the secret immediately at its source;
  remove it from any local files and logs; never merely delete the exposure and
  keep using the same secret.
