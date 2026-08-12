const PRODUCTION_TARGET = "production";
const PRODUCTION_ACKNOWLEDGEMENT = "CREATE_EXACTLY_ONE_PRODUCTION_OWNER";
const APPLICATION_ROLE = "crr_application";
const NEON_HOST_SUFFIX = ".neon.tech";
const REQUIRED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type SeedTarget = "local" | "test" | "production";

/** The only environment variables the standalone seed is allowed to read. */
export interface SeedEnvironment {
  readonly DATABASE_URL?: string;
  readonly SEED_OWNER_EMAIL?: string;
  readonly SEED_OWNER_PASSWORD?: string;
  readonly SEED_TARGET?: string;
  readonly ALLOW_PRODUCTION_FIRST_OWNER_SEED?: string;
}

export interface SeedStartupConfiguration {
  readonly databaseUrl: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly target: SeedTarget;
}

type SeedPreconditionCode =
  | "DATABASE_URL_REQUIRED"
  | "DATABASE_URL_INVALID"
  | "SEED_CREDENTIALS_REQUIRED"
  | "SEED_EMAIL_INVALID"
  | "SEED_PASSWORD_INVALID"
  | "SEED_TARGET_INVALID"
  | "PRODUCTION_ACKNOWLEDGEMENT_REQUIRED"
  | "PRODUCTION_APPLICATION_ROLE_REQUIRED"
  | "PRODUCTION_POOLED_NEON_URL_REQUIRED"
  | "PRODUCTION_SSL_REQUIRED"
  | "MANAGED_NEON_TARGET_FORBIDDEN";

export class SeedPreconditionError extends Error {
  readonly code: SeedPreconditionCode;

  constructor(code: SeedPreconditionCode, message: string) {
    super(message);
    this.name = "SeedPreconditionError";
    this.code = code;
  }
}

export class SeedConflictError extends Error {
  readonly code = "SEED_ACCOUNT_CONFLICT";

  constructor() {
    super(
      "Seed conflict: the requested administrator account already exists; no changes made.",
    );
    this.name = "SeedConflictError";
  }
}

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function parseTarget(value: string | undefined): SeedTarget {
  if (value === undefined || value === "") return "local";
  if (value === "local" || value === "test" || value === PRODUCTION_TARGET) {
    return value;
  }
  throw new SeedPreconditionError(
    "SEED_TARGET_INVALID",
    "SEED_TARGET must be local, test, or production.",
  );
}

function parseDatabaseUrl(raw: string | undefined): URL {
  if (!present(raw)) {
    throw new SeedPreconditionError(
      "DATABASE_URL_REQUIRED",
      "DATABASE_URL is required by the one-off seed process.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SeedPreconditionError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new SeedPreconditionError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }
  return url;
}

function isNeonHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized.endsWith(NEON_HOST_SUFFIX);
}

function validateProductionTarget(
  environment: SeedEnvironment,
  url: URL,
): void {
  if (
    environment.ALLOW_PRODUCTION_FIRST_OWNER_SEED !== PRODUCTION_ACKNOWLEDGEMENT
  ) {
    throw new SeedPreconditionError(
      "PRODUCTION_ACKNOWLEDGEMENT_REQUIRED",
      "Production first-owner seeding requires the exact explicit acknowledgement.",
    );
  }
  if (url.username !== APPLICATION_ROLE) {
    throw new SeedPreconditionError(
      "PRODUCTION_APPLICATION_ROLE_REQUIRED",
      "Production seeding requires the crr_application database role.",
    );
  }
  if (!isNeonHostname(url.hostname) || !url.hostname.includes("-pooler")) {
    throw new SeedPreconditionError(
      "PRODUCTION_POOLED_NEON_URL_REQUIRED",
      "Production seeding requires the approved pooled Neon connection.",
    );
  }
  if (!REQUIRED_SSL_MODES.has(url.searchParams.get("sslmode") ?? "")) {
    throw new SeedPreconditionError(
      "PRODUCTION_SSL_REQUIRED",
      "Production seeding requires SSL in DATABASE_URL.",
    );
  }
}

/**
 * Parse only the standalone seed's five environment variables.
 *
 * This deliberately does not import or invoke the application's environment
 * parser, so auth, provider, deployment, and migration configuration cannot
 * change seed eligibility.
 */
export function parseSeedEnvironment(
  input: Record<string, string | undefined>,
): SeedStartupConfiguration {
  const environment: SeedEnvironment = {
    DATABASE_URL: input.DATABASE_URL,
    SEED_OWNER_EMAIL: input.SEED_OWNER_EMAIL,
    SEED_OWNER_PASSWORD: input.SEED_OWNER_PASSWORD,
    SEED_TARGET: input.SEED_TARGET,
    ALLOW_PRODUCTION_FIRST_OWNER_SEED: input.ALLOW_PRODUCTION_FIRST_OWNER_SEED,
  };

  const target = parseTarget(environment.SEED_TARGET);
  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);

  if (
    !present(environment.SEED_OWNER_EMAIL) ||
    !present(environment.SEED_OWNER_PASSWORD)
  ) {
    throw new SeedPreconditionError(
      "SEED_CREDENTIALS_REQUIRED",
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required for seeding.",
    );
  }
  if (!EMAIL_PATTERN.test(environment.SEED_OWNER_EMAIL.trim())) {
    throw new SeedPreconditionError(
      "SEED_EMAIL_INVALID",
      "SEED_OWNER_EMAIL must be a valid email address.",
    );
  }
  if (environment.SEED_OWNER_PASSWORD.length < 12) {
    throw new SeedPreconditionError(
      "SEED_PASSWORD_INVALID",
      "SEED_OWNER_PASSWORD must contain at least 12 characters.",
    );
  }

  if (target === PRODUCTION_TARGET) {
    validateProductionTarget(environment, databaseUrl);
  } else if (isNeonHostname(databaseUrl.hostname)) {
    throw new SeedPreconditionError(
      "MANAGED_NEON_TARGET_FORBIDDEN",
      "A Neon database requires SEED_TARGET=production and the Production safeguards.",
    );
  }

  return Object.freeze({
    databaseUrl: environment.DATABASE_URL as string,
    ownerEmail: environment.SEED_OWNER_EMAIL,
    ownerPassword: environment.SEED_OWNER_PASSWORD,
    target,
  });
}

export function safeSeedErrorMessage(error: unknown): string {
  if (
    error instanceof SeedPreconditionError ||
    error instanceof SeedConflictError
  ) {
    return error.message;
  }
  return "The seed failed safely without writing data.";
}
