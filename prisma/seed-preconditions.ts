export interface SeedEnvironment {
  readonly VERCEL_ENV?: string;
  readonly DIRECT_DATABASE_URL?: string;
  readonly SEED_OWNER_EMAIL?: string;
  readonly SEED_OWNER_PASSWORD?: string;
}

export interface SeedStartupConfiguration {
  readonly directDatabaseUrl: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
}

export class SeedPreconditionError extends Error {
  readonly code:
    | "PRODUCTION_SEED_FORBIDDEN"
    | "SEED_CREDENTIALS_REQUIRED"
    | "DIRECT_DATABASE_URL_REQUIRED"
    | "PASSWORD_HASHING_UNAVAILABLE";

  constructor(code: SeedPreconditionError["code"], message: string) {
    super(message);
    this.name = "SeedPreconditionError";
    this.code = code;
  }
}

export function assertSeedStartupPreconditions(
  environment: SeedEnvironment,
): SeedStartupConfiguration {
  if (environment.VERCEL_ENV === "production") {
    throw new SeedPreconditionError(
      "PRODUCTION_SEED_FORBIDDEN",
      "The seed skeleton must never run in Production.",
    );
  }
  if (
    environment.SEED_OWNER_EMAIL === undefined ||
    environment.SEED_OWNER_PASSWORD === undefined
  ) {
    throw new SeedPreconditionError(
      "SEED_CREDENTIALS_REQUIRED",
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required for seeding.",
    );
  }
  if (environment.DIRECT_DATABASE_URL === undefined) {
    throw new SeedPreconditionError(
      "DIRECT_DATABASE_URL_REQUIRED",
      "DIRECT_DATABASE_URL is required by the one-off seed process.",
    );
  }

  return Object.freeze({
    directDatabaseUrl: environment.DIRECT_DATABASE_URL,
    ownerEmail: environment.SEED_OWNER_EMAIL,
    ownerPassword: environment.SEED_OWNER_PASSWORD,
  });
}

export function assertPhase2PasswordHashingAvailable(): never {
  throw new SeedPreconditionError(
    "PASSWORD_HASHING_UNAVAILABLE",
    "Owner creation is disabled until the Phase 2 Argon2id password-hashing service is available.",
  );
}

export function safeSeedErrorMessage(error: unknown): string {
  if (error instanceof SeedPreconditionError) return error.message;
  return "The seed skeleton failed safely without writing data.";
}
