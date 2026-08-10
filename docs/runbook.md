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
| Hosting              | Vercel (Preview only in Phase 0)                  |
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

| Task                      | Command                 |
| ------------------------- | ----------------------- |
| Dev server                | `pnpm dev`              |
| Format check              | `pnpm format:check`     |
| Type check                | `pnpm typecheck`        |
| Lint                      | `pnpm lint`             |
| Unit tests                | `pnpm test:unit`        |
| Integration tests         | `pnpm test:integration` |
| All Vitest tests          | `pnpm test`             |
| Production build          | `pnpm build`            |
| Production start          | `pnpm start`            |
| End-to-end (dev server)   | `pnpm test:e2e`         |
| End-to-end (CI/prod path) | `CI=true pnpm test:e2e` |

`CI=true` makes Playwright build-and-`next start` instead of using the dev
server, so always run `pnpm build` first (the CI workflow does this for you).

## Architecture boundaries

- Provider SDKs (Cloudinary, Resend, Upstash, Sentry) may be imported **only**
  from `src/server/integrations/`. This is enforced by ESLint
  (`no-restricted-imports`) for `src/server/modules/**`, `src/components/**`,
  and `src/app/**`.
- BigInt values must not leave service DTOs; convert at the service boundary.
- All money is stored and handled as whole TZS (no minor units, no floats).
- Phone numbers are stored in E.164 format.
- All date/time decisions use the `Africa/Dar_es_Salaam` timezone.
- HTTP handlers attach correlation IDs and return safe response envelopes.
- Secrets are never committed to the repository.

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

**Actual Neon query benchmark**: <PENDING — see note>. If performed, record the
median / p95 / min / max of ≥ 10 sequential `SELECT 1` round trips here. If not
performed, state that only the regional network-path benchmark was completed.

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
| Vercel project (human name) | crown-and-royal-rides                                                      |
| Public preview URL / alias  | <PENDING — set after first preview deployment>                             |
| Vercel Preview env vars set | `NEXT_PUBLIC_APP_URL`, `APP_ORIGIN`, `DATABASE_URL`, `DIRECT_DATABASE_URL` |

Not set in Phase 0 (unused by the static app): `AUTH_URL`, `AUTH_SECRET`,
`IP_HASH_SECRET`, `CRON_SECRET`, `SEED_OWNER_*`, `SENTRY_AUTH_TOKEN`, and the
Cloudinary / Resend / Upstash / Sentry runtime groups. Vercel's system variables
(`VERCEL_ENV`, `NODE_ENV`) are managed by Vercel and not set manually.

## Deployment

Local Vercel CLI preview workflow (no GitHub connection, no Production deploy):

```bash
# 1. Authenticate (opens a browser; never paste tokens into a terminal you share)
vercel login

# 2. Link the local workspace to the Vercel project (no Git connection)
vercel link

# 3. Create a Preview deployment (NO --prod flag)
vercel deploy

# 4. If a stable preview alias exists, point it at the new deployment
vercel alias set <deployment-url> <preview-alias>

# 5. Verify (see Phase 0 verification)
```

- Preview vs Production: Phase 0 creates **Preview only**. Never pass `--prod`.
- Preview environment variables are entered through the Vercel dashboard
  (Project → Settings → Environment Variables, scope = Preview) to keep secrets
  out of terminal history.
- The generated `*.vercel.app` deployment URL is public and non-secret; the
  `.vercel/` link metadata is git-ignored and is not authored source.

## CI status

- `.github/workflows/ci.yml` exists locally and defines two jobs:
  - `quality`: install (frozen) → format check → typecheck → lint → tests →
    build.
  - `e2e`: install → Playwright browsers → build → end-to-end tests.
- All local equivalents of these steps pass (see Phase 0 verification).
- **GitHub Actions has not been executed remotely.** Reason: project policy
  forbids all GitHub operations (no repository, remote, or push exists).
- Activating remote CI requires future, explicit authorization to use GitHub.

This runbook does not claim CI "is running" — only that the workflow is defined
and its steps pass locally.

## Phase 0 verification

Dated results — **2026-08-10** (local Node 26.2.0, pnpm 11.9.0):

| Check                              | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| `pnpm install --frozen-lockfile`   | Pass (lockfile up to date)                  |
| `pnpm format:check`                | Pass                                        |
| `pnpm typecheck`                   | Pass                                        |
| `pnpm lint`                        | Pass                                        |
| Unit tests                         | 394 passed                                  |
| Integration tests                  | Empty (intentional, `--passWithNoTests`)    |
| `pnpm test` (all Vitest)           | 394 passed                                  |
| `pnpm build`                       | Pass                                        |
| E2E (dev path)                     | 27 passed                                   |
| E2E (`CI=true`, `next start` path) | 27 passed                                   |
| Boundary-lint negative test        | Fails as expected (`no-restricted-imports`) |
| Environment key audit              | 26 keys, exact set equality                 |
| Secret scan                        | Clean (only test placeholders)              |
| Preview deployment                 | <PENDING — completed in cloud step>         |
| Docker (static compose validation) | Valid                                       |
| Docker (runtime)                   | Blocked — daemon not running                |
| Remote GitHub Actions              | Deferred by explicit project policy         |

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
