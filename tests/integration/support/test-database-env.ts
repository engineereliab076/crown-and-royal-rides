/**
 * Destructive-safety gate for the database integration harness.
 *
 * The integration suite creates, truncates, and drops objects. That is only ever
 * allowed against a database that provably identifies itself as disposable and
 * test-only. This parser validates dedicated `TEST_*` variables — never the
 * application's `DATABASE_URL`/`DIRECT_DATABASE_URL` — and refuses to proceed
 * unless every guard passes.
 *
 * It is pure: no database connection, no `server-only`, no logging. Errors never
 * include the supplied URL, host, username, or password.
 */

export interface TestDatabaseConfig {
  /** Pooled runtime URL for the test Prisma client (TEST_DATABASE_URL). */
  readonly databaseUrl: string;
  /** Direct URL for migration commands (TEST_DIRECT_DATABASE_URL). */
  readonly directUrl: string;
  /** The validated, marker-bearing database name (non-secret identifier). */
  readonly databaseName: string;
}

export type EnvSource = Record<string, string | undefined>;

/** A safety failure whose message never contains a URL, host, or credential. */
export class TestDatabaseSafetyError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(
      "Refusing to run destructive database tests:\n" +
        reasons.map((reason) => `- ${reason}`).join("\n"),
    );
    this.name = "TestDatabaseSafetyError";
    this.reasons = reasons;
  }
}

const DATABASE_URL_KEY = "TEST_DATABASE_URL";
const DIRECT_URL_KEY = "TEST_DIRECT_DATABASE_URL";
const ACKNOWLEDGEMENT_KEY = "ALLOW_TEST_DATABASE_DESTRUCTIVE_OPERATIONS";

/** A database name must clearly announce itself as disposable. */
const TEST_MARKER = /(test|scratch)/i;

/**
 * Hostname fragments that identify managed production/preview databases. The
 * project's real database lives on Neon; a `TEST_*` URL that points at any of
 * these is rejected outright regardless of naming.
 */
const BLOCKED_HOST_FRAGMENTS = [
  "neon.tech",
  "pooler.",
  "rds.amazonaws.com",
  "supabase.co",
  "azure.com",
];

/** Name fragments that must never appear in a destructive test database. */
const BLOCKED_NAME_FRAGMENTS = ["prod", "production", "preview", "staging"];

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parsePostgresUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return null;
  }
  return url;
}

/** Extract the database name from a postgres URL's pathname (`/name`). */
function databaseNameOf(url: URL): string {
  const raw = url.pathname.replace(/^\//, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function checkUrl(
  label: string,
  value: string | undefined,
  reasons: string[],
): URL | null {
  if (value === undefined) {
    reasons.push(`${label} is required for the database integration harness.`);
    return null;
  }
  const url = parsePostgresUrl(value);
  if (url === null) {
    reasons.push(`${label} must be a valid postgres:// or postgresql:// URL.`);
    return null;
  }
  for (const fragment of BLOCKED_HOST_FRAGMENTS) {
    if (url.hostname.toLowerCase().includes(fragment)) {
      reasons.push(
        `${label} points at a managed/production-style host and is not allowed for destructive tests.`,
      );
      return null;
    }
  }
  return url;
}

function checkDatabaseName(
  label: string,
  url: URL,
  reasons: string[],
): string | null {
  const name = databaseNameOf(url);
  if (name === "") {
    reasons.push(`${label} must include a database name.`);
    return null;
  }
  const lower = name.toLowerCase();
  for (const fragment of BLOCKED_NAME_FRAGMENTS) {
    if (lower.includes(fragment)) {
      reasons.push(
        `${label} database name "${name}" looks like a real environment (contains "${fragment}").`,
      );
      return null;
    }
  }
  if (!TEST_MARKER.test(name)) {
    reasons.push(
      `${label} database name "${name}" must contain a clear marker such as "test" or "scratch".`,
    );
    return null;
  }
  return name;
}

/**
 * Validate the dedicated test-database environment and return a safe config.
 * Throws {@link TestDatabaseSafetyError} — with no URL/host/credential in the
 * message — if any guard fails.
 */
export function loadTestDatabaseConfig(
  source: EnvSource = process.env,
): TestDatabaseConfig {
  const reasons: string[] = [];

  const databaseUrlValue = blankToUndefined(source[DATABASE_URL_KEY]);
  const directUrlValue = blankToUndefined(source[DIRECT_URL_KEY]);
  const acknowledgement = blankToUndefined(source[ACKNOWLEDGEMENT_KEY]);

  const databaseUrl = checkUrl(DATABASE_URL_KEY, databaseUrlValue, reasons);
  const directUrl = checkUrl(DIRECT_URL_KEY, directUrlValue, reasons);

  const databaseName =
    databaseUrl !== null
      ? checkDatabaseName(DATABASE_URL_KEY, databaseUrl, reasons)
      : null;
  if (directUrl !== null) {
    // The direct URL's name is validated too, but only the pooled name is
    // returned; both must satisfy the marker rule.
    checkDatabaseName(DIRECT_URL_KEY, directUrl, reasons);
  }

  // The acknowledgement is a second, independent guard — never a substitute for
  // a correctly named test database. Both must hold.
  if (acknowledgement !== "true") {
    reasons.push(
      `${ACKNOWLEDGEMENT_KEY} must be set to "true" to permit destructive database operations.`,
    );
  }

  if (
    reasons.length > 0 ||
    databaseUrlValue === undefined ||
    directUrlValue === undefined ||
    databaseName === null
  ) {
    throw new TestDatabaseSafetyError(reasons);
  }

  return {
    databaseUrl: databaseUrlValue,
    directUrl: directUrlValue,
    databaseName,
  };
}
