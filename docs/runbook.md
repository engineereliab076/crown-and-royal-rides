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
| Seed the first owner       | `pnpm db:seed`           |
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

### First-owner seed

Prisma 7 invokes `prisma/seed.ts` explicitly through `pnpm db:seed`; it is not
run automatically by migration commands. Treat seeding as a one-off
administrative operation. It has a dedicated parser that reads only
`DATABASE_URL`, `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_TARGET`, and
`ALLOW_PRODUCTION_FIRST_OWNER_SEED`; application/provider configuration cannot
change seed eligibility. A complete email/password pair is required (email a
valid address; password at least 12 characters), and the password is never
printed, logged, or stored — only its Argon2id hash is persisted.

**Argon2 native dependency.** Password hashing uses the `argon2` package, a
native Node addon. Its install/build script is approved for exactly that package
in `pnpm-workspace.yaml` (`allowBuilds: argon2: true`), so `pnpm install` compiles
or selects the platform binary. If the module fails to load, re-run
`pnpm install` so the build step runs. The seed reuses the same production
Argon2id helper via `tsx --conditions=react-server` (the helper is `server-only`;
that condition lets it load in this legitimately server-side Node context and
does not weaken the browser-bundle protection for the app).

**Local/test procedure.** Supply values for the command only. Local/test targets
must not use a managed Neon hostname and need no Production acknowledgement:

```bash
DATABASE_URL="<local-or-test PostgreSQL URL>" \
SEED_OWNER_EMAIL="<initial owner email>" \
SEED_OWNER_PASSWORD="<strong private password of at least 12 characters>" \
pnpm db:seed
```

**Behavior.** The seed validates and normalizes the email, hashes the password
with the production Argon2id parameters, and creates at most one active `owner`
administrator with `mustChangePassword = true`. Inside a serializable
transaction it checks for any existing owner before hashing: an existing owner
is a successful unchanged stop, while a requested email already assigned to a
non-owner is a safe conflict. It never overwrites password, role, or account
state. Only `admin_users` is written.

**One-time Neon Production bootstrap.** Production requires all of these exact
conditions: `SEED_TARGET=production`,
`ALLOW_PRODUCTION_FIRST_OWNER_SEED=CREATE_EXACTLY_ONE_PRODUCTION_OWNER`, and a
PostgreSQL `DATABASE_URL` whose role is exactly `crr_application`, whose Neon
hostname contains `-pooler`, and whose `sslmode` requires SSL. Use the existing
least-privilege pooled application connection. Never use `DIRECT_DATABASE_URL`
or the `neondb_owner` migration role for seeding.

```bash
SEED_TARGET=production \
ALLOW_PRODUCTION_FIRST_OWNER_SEED=CREATE_EXACTLY_ONE_PRODUCTION_OWNER \
DATABASE_URL="<pooled Production Neon URL for crr_application with SSL required>" \
SEED_OWNER_EMAIL="<initial owner email>" \
SEED_OWNER_PASSWORD="<strong private password of at least 12 characters>" \
pnpm db:seed
```

**Never commit or share the plaintext seed password.** Provide it only for the
single seed command (shell/session scope), rotate it if it is ever exposed, and
keep it out of the repository, `.env`/`.env.local`, logs, and chat history.

## Admin authentication (Auth.js)

Admin authentication uses Auth.js v5 (`next-auth`) with a Credentials provider
and **JWT sessions**. The Auth.js route is mounted at `/api/admin/auth/*`.

**Local login setup.**

1. Seed a first owner (see "First-owner seed").
2. Set `AUTH_SECRET` in `.env.local` — Auth.js requires it to sign/verify the
   session JWT. Generate a fresh value (≥ 32 chars), e.g.
   `openssl rand -base64 33`, and never reuse `IP_HASH_SECRET`/`CRON_SECRET`.
   `AUTH_URL` is optional locally (`trustHost` is enabled); set it in
   deployments. These keys already exist in `.env.example`; no new keys were
   added for this group.
3. Start the app and sign in at `/admin/login`.

**Secrets.** `AUTH_SECRET` signs the JWT; a valid token is required for any
`/admin/*` or `/api/admin/*` route. `IP_HASH_SECRET` is used to HMAC rate-limit
identifiers (emails/IPs are never stored raw); it is mandatory once the shared
(Upstash) rate-limit backend is active.

**Rate limiting.** Login is throttled on two axes — five attempts per normalized
email and twenty per client IP, each per 15-minute fixed window — and password
changes are throttled per administrator. Keys are namespaced and HMAC-hashed.
The policy is **fail-closed**: if the rate-limit provider is unavailable, the
attempt is denied rather than allowed. Login failures (unknown email, wrong
password, inactive account, malformed hash, invalid input) all return one
generic message and never reveal whether an account exists.

**Forced password change.** A freshly seeded owner has
`mustChangePassword = true`. Such an administrator can reach only
`/admin/change-password` (and logout/auth endpoints); every other protected page
and API is blocked until the password is changed. Changing the password rotates
the hash, clears the flag, and increments `sessionVersion` in one atomic update,
which invalidates the existing session — the user is signed out and must sign in
again.

**Middleware is deliberately limited.** `src/middleware.ts` only checks that a
cryptographically valid Auth.js session cookie exists (redirecting anonymous
page requests to `/admin/login` and returning 401 for anonymous admin APIs). It
never imports Prisma, the auth repository/service, or Argon2, never touches the
database, and enforces no role or business rules. The authoritative,
database-backed checks (existence, active status, session version, current role,
forced-change) run in Node: the Auth.js session callback performs exactly one
indexed lookup per session retrieval, and the protected layout, the route-handler
auth guard (`src/server/http/auth-guard.ts`), and the services enforce access.

### Administrator management and audit logging

Administrator management and audit-log access are owner-only. Newly created
administrators and password resets use cryptographically generated temporary
passwords: the plaintext is displayed once in the successful response, only its
Argon2id hash is stored, and the administrator must change it after signing in.

Role changes, deactivation, and password resets increment `sessionVersion`, so
sessions issued before those events stop validating. Reactivation preserves the
already-incremented version and cannot revive an invalidated session. A
serializable, row-locking transaction prevents deactivating or demoting the last
active owner, including under concurrent requests.

Successful administrator creation, role change, deactivation, reactivation, and
password reset each append one audit record atomically with the mutation. Audit
metadata may contain safe before/after state and a correlation ID, but must never
contain plaintext or hashed passwords, session tokens, credentials, secrets, or
database URLs. Audit records are append-only through application code.
**Service-layer `requireCapability` remains authoritative** — the guard is a
convenience, not a replacement, so business operations still check capabilities
themselves.

### Admin shell and protected routes

The protected shell uses the database-validated session once per request and
provides a desktop sidebar, mobile sheet navigation, breadcrumb-style header,
signed-in administrator identity, and logout control. Navigation comes from one
definition and is filtered with the capability matrix: Users requires
`admin:manage`, Audit Log requires `audit:read`, and Settings requires
`settings:update`. Hidden links are only presentation; page guards, API guards,
and service capability checks remain authoritative.

Implemented administration pages and APIs:

| Area      | Page               | API                                              |
| --------- | ------------------ | ------------------------------------------------ |
| Users     | `/admin/users`     | `/api/admin/users` and `/api/admin/users/[id]/*` |
| Audit log | `/admin/audit-log` | `/api/admin/audit-log`                           |
| Settings  | `/admin/settings`  | `GET` / `PUT /api/admin/settings`                |

Temporary passwords from administrator creation or reset live only in component
memory, are displayed in a clearly marked one-time dialog, and are cleared when
the dialog closes or the page unmounts. They must never be placed in browser
storage, URLs, cookies, logs, analytics, toasts, or audit metadata.

Business settings use only the existing `business_settings` singleton row
(`id = 1`). Updates require `settings:update`; a successful change and its
`settings.updated` audit row commit atomically. Audit metadata stores only the
names of changed fields and the request correlation ID. No-op and failed updates
write no successful audit record.

Role changes, deactivation, administrator password resets, and self-service
password changes invalidate earlier sessions through `sessionVersion`.
Reactivation does not restore an older invalidated version. The Auth.js session
callback continues to perform one indexed administrator lookup per validation.

For a new database, use the applicable manual first-owner procedure above before
signing in. Supply seed values only for that command and never persist or share
the plaintext password. Production must use the exact acknowledgement and the
existing pooled `crr_application` connection; seeding never uses the migration
role or `DIRECT_DATABASE_URL`.

## Database migrations

Prisma ORM 7 with the `pg` driver adapter. The schema lives in
`prisma/schema.prisma`; the Prisma 7 configuration (schema location, migrations
directory, and the migration datasource binding) lives in `prisma.config.ts`.
Generated Prisma Client is written to `src/generated/prisma` and is **not**
committed — it is regenerated on every install (`postinstall`) and on Vercel
builds, and is git-ignored.

**Ownership and phasing.** Migrations are feature-owned: each feature brings its
own migration when it is built.

- Phase 1 (`0001_foundation`) creates only the genuinely shared foundation
  tables and enums: `admin_users`, `admin_audit_log`, `brands`,
  `business_settings`, `media_deletion_queue`, plus the `admin_role` and
  `listing_state` enums. `listing_state` is created now because later feature
  tables share it.
- Phase 3, Group 1 (`0002_vehicles`, `0003_vehicle_images`, `0004_inquiries`)
  adds the vehicle catalogue foundation. See "Phase 3 migrations" below.
- Inquiry request fields (beyond the Phase 3 foundation) arrive in Phase 8.
- Rental packages arrive in Phase 9. They are **not** created in Phase 3;
  `inquiries.package_id` is a bare nullable placeholder column with no foreign
  key so the subject-exclusivity CHECK can exist before the packages table does.

### Phase 3 migrations (0002–0004)

These three additive migrations are **feature-owned by Phase 3** and, like
`0001`, are **frozen once applied to any shared environment** — never rewrite an
applied/shared migration; every later change is a new, additive migration.

- **`0002_vehicles`** — the `vehicles` table and its six enums (`body_type`,
  `vehicle_condition`, `transmission`, `fuel_type`, `driver_option`,
  `sale_status`). It models exactly one commercial mode (sale) via `is_for_sale`,
  `sale_status`, and a `bigint` `sale_price`. Reuses the shared `listing_state`
  for publication. Reviewed raw SQL: the `pg_trgm` extension; the STORED
  generated columns `search_text` (trigram source) and `search_vector`
  (full-text `tsvector`, `'english'`); a GIN full-text index and a GIN pg_trgm
  index over them; and five named CHECK constraints
  (`vehicles_sale_price_positive_check`, `vehicles_sale_status_required_check`,
  `vehicles_sale_price_required_check`, `vehicles_sale_disabled_null_check`,
  `vehicles_year_range_check`). `brand_id` is `ON DELETE RESTRICT`.
- **`0003_vehicle_images`** — the `vehicle_images` table (Cloudinary
  `public_id`/`secure_url` plus verified `width`/`height`/`format`/`byte_size`,
  `alt_text`, `sort_order`, `is_cover`). Reviewed raw SQL: a **partial** unique
  index `vehicle_images_one_cover_per_vehicle_idx` (`WHERE is_cover = true`,
  at most one cover per vehicle) and a **DEFERRABLE** unique constraint
  `vehicle_images_vehicle_id_sort_order_key` on `(vehicle_id, sort_order)` so a
  whole-gallery reorder can run in one transaction. `vehicle_id` is
  `ON DELETE CASCADE`.
- **`0004_inquiries`** — the `inquiries` foundation and its `inquiry_type`
  (`purchase`, `viewing`) and `inquiry_status` (`new`, `in_progress`, `closed`)
  enums, with a JSON `subject_snapshot`. Reviewed raw SQL: three named CHECK
  constraints — `inquiries_subject_exclusive_check` (exactly one of vehicle /
  package), `inquiries_purchase_fields_check` (purchase ⇒ vehicle subject and no
  viewing-only field), `inquiries_viewing_fields_check` (viewing ⇒ its viewing
  field). `vehicle_id` is `ON DELETE RESTRICT` — nulling a vehicle inquiry's
  subject would violate the exclusivity CHECK, so a vehicle with inquiries cannot
  be hard-deleted (archive it via `listing_state` instead).

**How Prisma-invisible constructs stay drift-free.** `schema.prisma` mirrors each
construct in the form Prisma introspects it, so `migrate diff` sees no drift:
STORED generated columns are declared with `@default(dbgenerated("…"))`; the GIN
indexes as `@@index(…, type: Gin)`; the deferrable unique as a plain `@@unique`
(deferring is tolerated). CHECK constraints and the partial cover index are
invisible to `migrate diff` and are kept raw-only (the partial index is
deliberately **not** a field `@unique`, which would make Prisma infer a bogus 1:1
vehicle↔image relation). Every one of these is asserted at the catalog level by
`db:migrate:verify`.

**Reviewer checklist for the Phase 3 raw SQL** (in addition to the general
"Raw-SQL migration review checklist" below):

- **CHECK constraints** — every constraint has a stable name; `NULL` semantics are
  understood (the `is_for_sale` / `type` columns referenced by the CHECKs are
  `NOT NULL`, so no CHECK can pass by evaluating to `NULL`); each invariant has a
  failing-insert test asserting SQLSTATE `23514` and the constraint name.
- **Generated columns** — the expression is `IMMUTABLE` and reproducible
  (`to_tsvector('english', …)` two-arg form; `||`/`COALESCE`); the schema mirror
  uses `@default(dbgenerated("…"))`; a test proves auto-population and recompute.
- **Partial index** — the `WHERE is_cover = true` predicate is exact and
  documented; kept raw-only (never a field `@unique`); a test proves at most one
  cover per vehicle.
- **Deferrable constraint** — declared `DEFERRABLE INITIALLY IMMEDIATE`; a test
  proves both immediate rejection of duplicates and a successful whole-gallery
  swap inside a `SET CONSTRAINTS ALL DEFERRED` transaction.

**Verifying these migrations locally (disposable databases only).** Use the
throwaway Docker PostgreSQL and clearly-named `*_test` / `*_scratch` databases —
never Neon (see "Configuring a local test database" for full setup and the
`POSTGRES_PORT` caveat when host port 5432 is occupied by a native PostgreSQL):

```bash
# 1. Migration drift + catalog assertions (scratch DB).
export SHADOW_DATABASE_URL="postgresql://USER:PW@localhost:PORT/crown_royal_rides_scratch?schema=public"
pnpm db:migrate:verify

# 2. Constraint / search / relation integration tests (test DB).
export TEST_DATABASE_URL="postgresql://USER:PW@localhost:PORT/crown_royal_rides_test?schema=public"
export TEST_DIRECT_DATABASE_URL="$TEST_DATABASE_URL"
export ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true
pnpm test:integration
```

### Phase 3, Group 2 vehicle management

Vehicle creation is available to authenticated administrators with
`content:manage`. The service validates the strict client shape, resolves the
selected brand, copies its trimmed display name into `vehicles.brand_name`, and
creates a draft. The copy is intentional: the listing keeps a stable display and
search value if the live brand is renamed later, while `brand_id` remains the
authoritative identity and foreign key.

Slugs use `createVehicleSlug(brand, model, year, shortId)`. The short identifier
comes from Node's cryptographically secure random generator. Creation makes at
most three total attempts and retries only a Prisma `P2002` unique violation
that specifically identifies the Vehicle `slug`; unrelated database failures
propagate unchanged, while exhausted collisions become the safe
`VEHICLE_SLUG_CONFLICT` response.

Publishing is service-authoritative and requires a cover image, enabled sale
mode with a status, a positive sale price, and a trimmed description of at least
40 characters. A failed gate performs no update and returns
`VEHICLE_NOT_READY` with only safe missing-requirement names. A successful
publish atomically sets `listing_state = published` and `published_at`; repeating
the operation is idempotent.

Repository money remains PostgreSQL/Prisma `bigint`. Explicit DTO mappers call
`toShillings` so every outward `salePrice` is `number | null` and the DTO is JSON
serializable; never install a global BigInt JSON patch. Repository projections
and DTOs are allow-lists and exclude generated search fields and future private
fields.

Group 2 deliberately did not implement image upload or attachment,
Cloudinary signing, a public vehicle detail page/API, inquiries, WhatsApp, or
email notifications. Those remain Group 3/4 work.

### Phase 3, Group 3 cover upload and public detail

The administrator cover flow uses a signed direct upload. A same-origin,
authenticated `media:manage` request identifies only the vehicle; the server
confirms the actor also has `content:manage`, confirms that the vehicle exists
and has no cover, and derives the controlled
`<CLOUDINARY_FOLDER_PREFIX>/vehicles/vehicle/<vehicle-id>` folder. Authorization
is short-lived, image-only, overwrite-disabled, and limited to JPEG, PNG, and
WebP. The browser accepts one file, enforces the advertised 10 MB limit for
immediate feedback, uploads directly over HTTPS, and returns only the completed
`publicId`, `version`, and response `signature` to the application.

Completion metadata is never trusted from the browser. The Cloudinary adapter
authenticates the direct-upload response signature over `public_id + version`,
then uses Cloudinary's authenticated Admin API to inspect the resource. Only the
inspected HTTPS delivery URL, format, dimensions, byte size, resource type, and
creation timestamp are trusted. The adapter rejects the wrong namespace/account,
non-images, unsupported formats, non-positive or greater-than-6000 dimensions,
and files over 10 MB. No raw provider response or credential crosses the media
abstraction.

**Phase 4 — vehicle image gallery.**

There is a single canonical vehicle-image service
(`src/server/modules/vehicle-images`). It owns every gallery operation —
`getGallery`, signed-upload authorization, `attach`, `reorder`, `setCover`,
`updateAltText`, and `remove` — and the Phase 3 "first image becomes the cover"
behavior is now just the empty-gallery case of `attach`. The old single-cover
route/service/uploader were removed; the `/api/admin/media/signature` flow
continues to work and now issues authorization through this service.

_Gallery rules._ A vehicle holds at most **15 images**, enforced inside the same
transaction as attachment (the parent row is locked, so a concurrent pair at the
limit can never leave 16). Accepted upload formats are **JPEG/JPG, PNG, WebP**.
Images are compressed **in the browser** before any upload: the longest edge is
reduced to ≤ **2400 px**, EXIF metadata is stripped (never preserved), the output
stays an allowed format below the server's verified **10 MB** limit, and a
compression failure fails only that one file — an uncompressed fallback is never
uploaded silently. Ordering is a contiguous `sort_order` starting at 0; a reorder
persists the whole set in one batch `PATCH` using the deferrable
`(vehicle_id, sort_order)` unique constraint. Exactly one cover exists, guarded by
the partial unique index; removing the cover promotes the remaining image with the
smallest `sort_order`, and removing the last image leaves no cover. Every image
requires non-empty alt text (≤ 160 chars).

_Optimistic concurrency._ `reorder` and `setCover` require the client's
`expectedUpdatedAt`; the service locks the vehicle, compares it to the stored
`updated_at`, and rejects a mismatch with `409 STALE_RECORD`. The admin UI
reorders optimistically and restores the server order on failure; on a stale
conflict it reloads the gallery and shows a clear message.

_Provider credentials never reach the browser._ The browser only ever receives a
short-lived signed upload authorization (no API secret) and delivered HTTPS URLs;
authorization is never written to `localStorage`, `sessionStorage`, cookies, query
strings, or logs. Public delivery uses a client-safe Cloudinary loader that only
rewrites the exact verified `res.cloudinary.com/.../image/upload/` structure
(`f_auto,q_auto,c_limit,w_<clamped>`), clamping widths to the ladder
`320,480,640,768,960,1200,1600,2000,2400`; any other URL is returned unchanged, so
no arbitrary remote host is opened.

_Deletion outbox + retry endpoint._ A removal deletes the database row and, in the
**same transaction**, records the provider-deletion intent in
`media_deletion_queue` (an outbox). Provider deletion is attempted only after the
commit: on success the queue row is resolved (deleted); on failure/timeout the row
remains for retry and only a constant `deletion_retry_failed` marker is stored —
never a public ID, provider response, or URL. A crash cannot lose the obligation.
The retry worker (`POST /api/cron/media-deletions`) drains a bounded batch (≤ 25,
oldest `created_at` then id), treats provider not-found as success, increments
`attempts`/sets `last_attempted_at` on failure, and permanently retains (never
discards) entries past 10 attempts for human inspection. It returns only safe
counts `{ selected, deleted, retained, failed }`. Provider deletion is idempotent;
because the frozen queue schema has no claim column, two overlapping jobs may both
attempt the same entry (a harmless duplicate attempt).

_Invoking the retry endpoint safely._ Authenticate with a bearer token only — no
admin cookie and no browser-origin check. Never print `CRON_SECRET`; read it from
the environment:

```
curl -fsS -X POST "$APP_ORIGIN/api/cron/media-deletions" \
  -H "Authorization: Bearer $CRON_SECRET"
```

A missing/incorrect token returns `401`. No Vercel schedule is added in this
phase; the authenticated endpoint plus manual invocation are sufficient. To
monitor the queue, inspect `media_deletion_queue`: a persistently non-empty table
or rows with `attempts` near 10 indicate a provider problem — a stuck row's
`public_id`/`last_error` are safe operational values for an operator (a generic
marker, not a provider secret).

_Publication and cache._ Successful first publication commits
`published`/`publishedAt` before invalidating the stable `vehicle:<slug>` cache
tag. Gallery mutations to an **already-published** vehicle revalidate the same tag
**after** the database commit; draft mutations do not revalidate. Cache failure
never rolls back the committed mutation and is reported safely (no public ID/URL).
`/cars/[slug]` is a Server Component backed by the public DTO, an ISR window, and
the same tag; it renders an accessible gallery with a keyboard/swipe lightbox.
Drafts and missing slugs render Next.js 404.

_No migration was added in Phase 4._ The gallery, ordering, single-cover, and
deletion-outbox behaviors all use the existing `0002`/`0003` schema unchanged.

### Phase 5 — vehicle administration workflow

**Migration `0005_vehicle_admin_workflow`.** This additive migration is frozen.
It adds independent rental state and pricing, drivetrain, location, negotiable
pricing, driver notes, features, specifications, private identifiers, featured
ordering, and verification timestamps. Rental mode is one atomic group:
`is_for_rent = true` requires `rental_status`, a positive whole-TZS
`rental_daily_price`, and `min_rental_days` from 1–365; disabling rental clears
all three nullable values. Mileage is 0–2,000,000 km, engine capacity is
1–10,000 cc, seats 1–60, doors 1–8, and features are capped at 50. Featured
state and timestamp must agree. Registration and chassis numbers are optional,
trimmed and upper-cased by the application, then protected by partial unique
indexes when present.

**Administrative draft workflow.** A content manager creates the draft only
after Step 1 (Basics) succeeds, then resumes it at the real
`/admin/vehicles/<id>/edit?step=2` URL. The shared create/edit flow persists only
on explicit Save or Save and continue: (1) Basics, (2) Modes and pricing,
(3) Driver arrangement, (4) Specifications, (5) Description and features,
(6) the canonical Phase 4 gallery, and (7) Review. Refreshes load the committed
server DTO. Later steps may be opened directly for an existing vehicle, but the
server readiness checklist remains authoritative. Draft form values are never
written to browser storage or URLs; registration and chassis values remain in
admin-only fields and DTOs.

**Publication checklist.** Publication requires the server checklist to be
fully met: brand, model, year, body type, condition, transmission, fuel type,
drivetrain, location, at least one commercial mode and its complete status/
pricing group, description of at least 40 characters, at least one image,
exactly one cover, alt text on every image, used-vehicle mileage, a driver note
when `with_driver`, exterior colour, and seats. The Review step groups every
missing server item by its fixing step. Existing published rows missing newer
fields remain published and show a legacy-incomplete warning; there is no
automatic unpublish.

**Lifecycle and commercial transition matrix.** Routes do not call status
repository methods directly. All lifecycle and subsequent commercial-status
changes use `transitionVehicle()`:

| Action                                                                       | Allowed from / prerequisite | Result                                          |
| ---------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| `publish`                                                                    | ready draft                 | published; sets `publishedAt`                   |
| `unpublish`                                                                  | published                   | draft; clears publication and featured state    |
| `archive`                                                                    | draft or published          | archived; clears publication and featured state |
| `restore`                                                                    | archived                    | draft; remains unfeatured                       |
| `sale_available`, `sale_reserved`, `sale_sold`                               | sale mode enabled           | changes only sale status                        |
| `rental_available`, `rental_reserved`, `rental_rented`, `rental_unavailable` | rental mode enabled         | changes only rental status                      |

Sale and rental states are independent: `sale_sold` does not alter rental, so a
sold vehicle can remain publicly rentable. Initial mode enablement uses the
atomic modes/pricing PATCH required by the database checks; later status changes
use only the transition endpoint. Invalid source states return the safe
`INVALID_VEHICLE_TRANSITION` response. Public-impacting committed transitions
revalidate the vehicle cache tag server-side.

**Featured and verification operations.** Only a published, readiness-complete
vehicle can be featured. A serializable transaction locks the featured set and
the target; the ninth concurrent attempt returns `FEATURED_LIMIT_REACHED`, so
the displayed “N of 8” count is guidance, never the protection boundary.
Unpublish and archive always clear featured state. Featured public ordering is
`featured_at DESC, id ASC`. “Still available” calls `markVerified()` and changes
only `last_verified_at`; it never changes listing, sale, rental, or featured
state and is not an inquiry side effect.

**Brand propagation.** Brand create/update/delete is a capability-checked,
audited service workflow. A rename updates the brand and every linked vehicle's
denormalized display/search name inside one serializable transaction; the UI
makes one Brand API request and never performs vehicle-by-vehicle updates.
Brands referenced by vehicles cannot be deleted and return `BRAND_IN_USE`.

**Private identifier policy.** Registration and chassis numbers may appear only
in authenticated admin/server code and tests. They are excluded from public
repository projections and DTOs, catalogue pages, metadata, public APIs,
filter/search query parameters, analytics, logs, and client error reports.
Never add them to a public preview or serialize them into a shareable URL.

**Public settings groundwork.** `GET /api/settings/public` returns the exact
public settings allow-list through `getPublicSettings()`. Notification recipient
emails, `updatedById`, and timestamps are excluded. Reads use Next's server cache
for 300 seconds under the stable `settings` tag; settings writes revalidate that
tag. There is no process-memory settings cache, and Phase 5 does not consume the
DTO on the homepage.

**Guarded Phase 5 end-to-end.** `tests/e2e/phase5-vehicle-admin.spec.ts` drives
the full lifecycle (create, refresh-resume, publish, mode/status, feature,
verify, brand rename, archive, restore) and runs only under the same guarded
disposable-database contract as the Phase 3 slice (`RUN_DATABASE_E2E=true`, the
`TEST_*` `test`/`scratch` URLs, and `ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true`);
Cloudinary upload traffic is intercepted, so no live provider is called. It runs
on desktop Chromium and iPhone 13/WebKit; Pixel 5 skips it. Run this spec against
the compiled production server, not the dev server: this single spec exercises
many admin routes, and under `pnpm dev` Turbopack's first-request compilation is
slow enough on WebKit to exhaust the spec's 480 s budget, so build first and use
the `CI=true` (`next start`) path, for example:

```bash
pnpm build
CI=true RUN_DATABASE_E2E=true \
  TEST_DATABASE_URL="postgresql://USER:PW@localhost:PORT/crown_royal_rides_phase5_test?schema=public" \
  TEST_DIRECT_DATABASE_URL="$TEST_DATABASE_URL" \
  ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true \
  pnpm exec playwright test tests/e2e/phase5-vehicle-admin.spec.ts
```

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
2. **Intentional raw SQL presence** — after replaying migrations it asserts every
   reviewed custom construct exists at the catalog level, so drift in the raw SQL
   (which Prisma's diff cannot see) cannot pass unnoticed:
   - **0001** — `citext` extension; `business_settings_singleton_check`;
     `inquiry_notification_emails` NOT NULL.
   - **0002** — `pg_trgm` extension; `search_text`/`search_vector` are STORED
     generated columns; the GIN full-text and GIN pg_trgm indexes; the five
     vehicle sale/year CHECK constraints.
   - **0003** — the partial one-cover-per-vehicle unique index; the DEFERRABLE
     `(vehicle_id, sort_order)` unique constraint.
   - **0004** — the three inquiry subject/type CHECK constraints.

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

- `.env.example` documents the 26 application keys understood by
  `src/lib/env.schema.ts` plus the two seed-only non-secret controls
  (`SEED_TARGET` and `ALLOW_PRODUCTION_FIRST_OWNER_SEED`).
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

## Phase 3 Group 4 — purchase inquiries

The public purchase endpoint follows one fixed sequence: strict request
validation, trusted proxy-IP extraction, consuming IP and normalized-phone rate
limits, published/available vehicle lookup, immutable snapshot construction,
and committed inquiry creation. Only after a `201` response has been constructed
is the email task registered with Next.js `after()`. Email is never sent from a
repository, service transaction, or before the inquiry commit.

Purchase references use `CRR-XXXXXXXX`, where each `X` is one of the uppercase
unambiguous characters `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Eight characters are
drawn with Node's cryptographic random source. A collision is retried at most
three times, and only the inquiry-reference unique constraint is retryable.

The fixed-window purchase policy is 10 submissions per IP and 5 per normalized
Tanzanian phone number in 15 minutes. Both dimensions are consuming checks.
Their raw values are HMAC-SHA-256 protected with `IP_HASH_SECRET` before reaching
the limiter; raw IPs, phone numbers, HMAC inputs, and limiter keys are never
logged. The endpoint fails closed: real exhaustion is `429`, while provider or
configuration failure is `503` with safe diagnostic codes only.

Notification recipients and the business WhatsApp number come from the
singleton `BusinessSettings` row. Empty recipients deliberately skip email and
do not fail the saved inquiry. Rejected, throwing, or timed-out email delivery
also cannot change the response or stored row; the error reporter receives only
the correlation ID, inquiry reference, stable stage, and fixed operation name.
The send timeout is 2.5 seconds inside the post-response task.

The purchase form opens `about:blank` synchronously in the submit gesture,
retains the window handle, and severs `opener` before any external navigation.
This is necessary because opening WhatsApp only after awaiting `fetch` is blocked
by mobile browsers, while including `noopener` in `window.open` may cause
Chromium/WebKit to return no usable handle. A blocked popup never blocks saving:
the current page still shows the reference. Missing/invalid WhatsApp settings
close the blank window and leave the saved confirmation visible.

The guarded vertical slice is `tests/e2e/purchase-inquiry.spec.ts`. It runs only
when `RUN_DATABASE_E2E=true`, `TEST_DATABASE_URL` and
`TEST_DIRECT_DATABASE_URL` identify a local disposable `test`/`scratch`
database, and `ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true`. The web server
is bound to that test URL, workers are forced to one, identifiers are unique,
and the spec cleans only its exact rows. It runs on desktop Chromium and iPhone
13/WebKit; Pixel 5 skips this stateful scenario. The upload path uses the real
Group 3 UI plus an in-process `InMemoryMediaStorage`, Playwright interception of
the fake upload/attachment transport, and direct guarded test-DB verification.
`wa.me` and fake media delivery are intercepted, so no live provider is called.
No test-only application endpoint or production secret is added.

Group 4 intentionally stops at purchase submission, WhatsApp handoff, and the
minimal read-only administrator list. Viewing, rental-package and general
contact inquiries, inquiry detail/edit/status mutation, advanced filters,
catalogue search, and further media work remain out of scope.

## Phase 7 public catalogue discovery

The three catalogue routes use one URL-driven server search boundary and a fixed
page size of 24 on every device:

- `/cars` searches all currently usable published sale/rental vehicles.
- `/cars-for-sale` searches available and reserved sale vehicles and enables
  sale-price filtering/sorting.
- `/cars-for-rent` searches available and reserved rental vehicles and enables
  daily-price filtering/sorting.

Supported query parameters are `q`, `brand`, `bodyType`, `condition`,
`transmission`, `fuelType`, `drivetrain`, `driverOption`, `yearMin`, `yearMax`,
mode-specific `priceMin`/`priceMax`, `sort`, and `page`. Search covers the public
brand/model/search document maintained by the vehicle search schema. Location,
status, mileage, engine size, seats/doors, colours, features, negotiability,
featured state, and private identifiers are not public filters. Rejected values
are ignored without being reflected in controls or generated links.

Sorts are `newest` and `year_desc` everywhere; sale/rental routes additionally
support `price_asc` and `price_desc`; `relevance` is offered only when a
normalized search query exists. Default `newest`, page 1, blanks, and absent
filters are omitted from generated URLs. Any filter or non-default sort makes a
catalogue URL `noindex,follow`; unfiltered pages after page 1 are also
`noindex,follow`. Clean base catalogue pages are `index,follow`.

Reserved vehicles stay visible and indexable with their publicly permitted
price, but have no purchase/rental action and publish no Offer JSON-LD. Active
actionable details publish allow-listed Car/Offer data. Sold historical,
retired, unavailable, draft, and missing vehicles publish no vehicle JSON-LD.
All JSON-LD passes through the dedicated HTML-script escaping serializer.

Vehicle/settings reads use five-minute tagged data-cache entries. Catalogue
mutations invalidate catalogue tags, including the sitemap slug cache. The
sitemap contains the seven static public paths plus only centrally resolved
indexable vehicle details; it intentionally contains no filter, admin, API,
inquiry, or package URLs. Packages remain deferred. `robots.txt` allows public
paths, disallows `/admin/` and `/api/`, and references the canonical sitemap;
robots rules are discovery guidance, never authorization.

Run the guarded Phase 7 E2E flow only against a disposable local PostgreSQL
database whose name contains `test` or `scratch` and never points to Neon:

Set `TEST_DATABASE_URL` and `TEST_DIRECT_DATABASE_URL` to guarded localhost
values before running the command. Managed database hosts are rejected, the
database name must retain a `test` or `scratch` marker, and the destructive-test
acknowledgement remains mandatory.

```bash
RUN_DATABASE_E2E=true \
TEST_DATABASE_URL="<guarded-local-test-database-url>" \
TEST_DIRECT_DATABASE_URL="<guarded-local-test-direct-database-url>" \
ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS=true \
pnpm exec playwright test tests/e2e/phase7-public-search.spec.ts
```

Private-identifier names appear in tests only with conspicuously synthetic
values to assert that public DTOs and serialized responses exclude both the
field names and their values. They never enter public selects, cache data,
metadata, JSON-LD, sitemap output, HTML, or URLs.

For a production-build Lighthouse pass, start the compiled app with the same
guarded local database values, keep Cloudinary delivery intercepted/local, and
run an installed local Lighthouse CLI (do not audit a public deployment):

```bash
pnpm build
pnpm start
lighthouse http://localhost:3000/cars --form-factor=mobile --output=json --output-path=/tmp/catalogue-lighthouse.json --chrome-flags="--headless"
lighthouse http://localhost:3000/cars/LOCAL_FIXTURE_SLUG --form-factor=mobile --output=json --output-path=/tmp/detail-lighthouse.json --chrome-flags="--headless"
```

Google Rich Results behavior is not guaranteed by local schema-shape tests.
After a production release, manually validate representative active sale,
rental, and dual-mode URLs with Google's Rich Results Test. Do not run an
external validator during local implementation verification.

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
