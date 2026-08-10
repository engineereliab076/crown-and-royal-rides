import { z } from "zod";

/**
 * Pure, provider-free environment validation.
 *
 * This module never imports `server-only`, never reads `process.env`, and
 * never connects to any provider. It exposes `parseEnv` so the same logic can
 * be exercised by unit tests against controlled fake input.
 */

export type EnvironmentInput = Record<string, string | undefined>;

const nodeEnvValues = ["development", "test", "production"] as const;
const vercelEnvValues = ["development", "preview", "production"] as const;
const folderValues = ["dev", "preview", "prod"] as const;
const namespaceValues = ["dev:", "preview:", "prod:"] as const;
const sentryEnvValues = ["development", "preview", "production"] as const;

type VercelEnv = (typeof vercelEnvValues)[number];
type FolderPrefix = (typeof folderValues)[number];
type Namespace = (typeof namespaceValues)[number];
type SentryEnv = (typeof sentryEnvValues)[number];

const LOCAL_DEFAULT_URL = "http://localhost:3000";

/** Every environment variable this application understands. */
const KNOWN_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "NEXT_PUBLIC_APP_URL",
  "APP_ORIGIN",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "IP_HASH_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_FOLDER_PREFIX",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "INQUIRY_NOTIFICATION_FALLBACK",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RATE_LIMIT_NAMESPACE",
  "CRON_SECRET",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_AUTH_TOKEN",
  "SEED_OWNER_EMAIL",
  "SEED_OWNER_PASSWORD",
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];
type RawEnv = Record<KnownKey, string | undefined>;

/**
 * The validated, normalized environment shape. Inferred from the Zod pipeline
 * so the schema remains the single source of truth for the type.
 */
export type Environment = z.infer<typeof environmentSchema>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, and treat empty or whitespace-only strings as absent. */
function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalize(input: EnvironmentInput): RawEnv {
  const raw = {} as RawEnv;
  for (const key of KNOWN_KEYS) {
    raw[key] = blankToUndefined(input[key]);
  }
  return raw;
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return (values as readonly string[]).includes(value);
}

function coerceEnum<T extends readonly string[]>(
  values: T,
  value: string | undefined,
): T[number] | undefined {
  if (value === undefined) return undefined;
  return includesValue(values, value) ? value : undefined;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function originOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const url = parseUrl(value);
  return url ? url.origin : null;
}

function expectedFolder(vercelEnv: VercelEnv | undefined): FolderPrefix {
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "prod";
  return "dev";
}

function expectedNamespace(vercelEnv: VercelEnv | undefined): Namespace {
  if (vercelEnv === "preview") return "preview:";
  if (vercelEnv === "production") return "prod:";
  return "dev:";
}

function expectedSentryEnv(vercelEnv: VercelEnv | undefined): SentryEnv {
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "production";
  return "development";
}

/**
 * Minimal structural view of the Zod refinement context we rely on. Declared
 * locally so this module does not depend on Zod's internal type paths.
 */
interface Ctx {
  addIssue(issue: {
    code: "custom";
    message: string;
    path: (string | number)[];
  }): void;
}

function addIssue(ctx: Ctx, path: KnownKey, message: string) {
  ctx.addIssue({ code: "custom", path: [path], message });
}

/**
 * Report an all-or-none group: if some members are present, every missing
 * member is flagged. Returns whether the group has any values at all.
 */
function requireGroupTogether(
  ctx: Ctx,
  raw: RawEnv,
  members: KnownKey[],
): boolean {
  const present = members.filter((key) => raw[key] !== undefined);
  if (present.length === 0) return false;
  if (present.length < members.length) {
    for (const key of members) {
      if (raw[key] === undefined) {
        addIssue(ctx, key, "Required when any variable in its group is set");
      }
    }
  }
  return true;
}

/** Validate an origin-only URL and, on success, return its origin. */
function checkOriginUrl(
  ctx: Ctx,
  path: KnownKey,
  value: string,
  options: { httpsOnly: boolean },
): void {
  const url = parseUrl(value);
  if (!url) {
    addIssue(ctx, path, "Must be a valid absolute http(s) URL");
    return;
  }
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isHttp) {
    addIssue(ctx, path, "Must use the http or https protocol");
    return;
  }
  if (options.httpsOnly && url.protocol !== "https:") {
    addIssue(ctx, path, "Must use HTTPS in preview and production");
  }
  if (url.username !== "" || url.password !== "") {
    addIssue(ctx, path, "Must not contain a username or password");
  }
  if (url.pathname !== "/") {
    addIssue(ctx, path, "Must be an origin only, without a path");
  }
  if (url.search !== "") {
    addIssue(ctx, path, "Must not contain a query string");
  }
  if (url.hash !== "") {
    addIssue(ctx, path, "Must not contain a fragment");
  }
}

function checkPostgresUrl(ctx: Ctx, path: KnownKey, value: string): void {
  const url = parseUrl(value);
  if (!url) {
    addIssue(ctx, path, "Must be a valid URL");
    return;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    addIssue(ctx, path, "Must use the postgres: or postgresql: protocol");
  }
}

function checkHttpsUrl(ctx: Ctx, path: KnownKey, value: string): void {
  const url = parseUrl(value);
  if (!url) {
    addIssue(ctx, path, "Must be a valid URL");
    return;
  }
  if (url.protocol !== "https:") {
    addIssue(ctx, path, "Must be an HTTPS URL");
  }
}

function checkEmail(ctx: Ctx, path: KnownKey, value: string): void {
  if (!EMAIL_PATTERN.test(value)) {
    addIssue(ctx, path, "Must be a valid email address");
  }
}

function validate(raw: RawEnv, ctx: Ctx): void {
  // NODE_ENV
  if (
    raw.NODE_ENV !== undefined &&
    !includesValue(nodeEnvValues, raw.NODE_ENV)
  ) {
    addIssue(ctx, "NODE_ENV", "Must be development, test, or production");
  }

  // VERCEL_ENV
  if (
    raw.VERCEL_ENV !== undefined &&
    !includesValue(vercelEnvValues, raw.VERCEL_ENV)
  ) {
    addIssue(ctx, "VERCEL_ENV", "Must be development, preview, or production");
  }
  const vercelEnv = coerceEnum(vercelEnvValues, raw.VERCEL_ENV);
  const isDeployed = vercelEnv === "preview" || vercelEnv === "production";

  // Application URLs. Locally these default to localhost; on Vercel preview or
  // production they are required and must be HTTPS.
  const appUrl = raw.NEXT_PUBLIC_APP_URL;
  const appOriginRaw = raw.APP_ORIGIN;
  if (isDeployed) {
    if (appUrl === undefined) {
      addIssue(
        ctx,
        "NEXT_PUBLIC_APP_URL",
        "Required in preview and production deployments",
      );
    }
    if (appOriginRaw === undefined) {
      addIssue(
        ctx,
        "APP_ORIGIN",
        "Required in preview and production deployments",
      );
    }
  }
  if (appUrl !== undefined) {
    checkOriginUrl(ctx, "NEXT_PUBLIC_APP_URL", appUrl, {
      httpsOnly: isDeployed,
    });
  }
  if (appOriginRaw !== undefined) {
    checkOriginUrl(ctx, "APP_ORIGIN", appOriginRaw, { httpsOnly: isDeployed });
  }
  const effectiveAppUrl =
    appUrl ?? (isDeployed ? undefined : LOCAL_DEFAULT_URL);
  const effectiveAppOrigin =
    appOriginRaw ?? (isDeployed ? undefined : LOCAL_DEFAULT_URL);
  const appUrlOrigin = originOf(effectiveAppUrl);
  const appOrigin = originOf(effectiveAppOrigin);
  if (
    appUrlOrigin !== null &&
    appOrigin !== null &&
    appUrlOrigin !== appOrigin
  ) {
    addIssue(
      ctx,
      "APP_ORIGIN",
      "Must resolve to the same origin as NEXT_PUBLIC_APP_URL",
    );
  }

  // Database group
  if (requireGroupTogether(ctx, raw, ["DATABASE_URL", "DIRECT_DATABASE_URL"])) {
    if (raw.DATABASE_URL !== undefined) {
      checkPostgresUrl(ctx, "DATABASE_URL", raw.DATABASE_URL);
    }
    if (raw.DIRECT_DATABASE_URL !== undefined) {
      checkPostgresUrl(ctx, "DIRECT_DATABASE_URL", raw.DIRECT_DATABASE_URL);
    }
  }

  // Authentication group
  if (requireGroupTogether(ctx, raw, ["AUTH_SECRET", "AUTH_URL"])) {
    if (raw.AUTH_SECRET !== undefined && raw.AUTH_SECRET.length < 32) {
      addIssue(ctx, "AUTH_SECRET", "Must contain at least 32 characters");
    }
    if (raw.AUTH_URL !== undefined) {
      const url = parseUrl(raw.AUTH_URL);
      if (!url) {
        addIssue(ctx, "AUTH_URL", "Must be a valid http(s) URL");
      } else {
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          addIssue(ctx, "AUTH_URL", "Must use the http or https protocol");
        } else if (isDeployed && url.protocol !== "https:") {
          addIssue(ctx, "AUTH_URL", "Must use HTTPS in preview and production");
        }
        if (appOrigin !== null && url.origin !== appOrigin) {
          addIssue(ctx, "AUTH_URL", "Must have the same origin as APP_ORIGIN");
        }
      }
    }
  }

  // IP_HASH_SECRET
  if (raw.IP_HASH_SECRET !== undefined) {
    if (raw.IP_HASH_SECRET.length < 32) {
      addIssue(ctx, "IP_HASH_SECRET", "Must contain at least 32 characters");
    }
    if (
      raw.AUTH_SECRET !== undefined &&
      raw.IP_HASH_SECRET === raw.AUTH_SECRET
    ) {
      addIssue(ctx, "IP_HASH_SECRET", "Must not be equal to AUTH_SECRET");
    }
  }

  // Cloudinary group
  const cloudinaryKeys: KnownKey[] = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_FOLDER_PREFIX",
  ];
  if (requireGroupTogether(ctx, raw, cloudinaryKeys)) {
    const folder = raw.CLOUDINARY_FOLDER_PREFIX;
    if (folder !== undefined) {
      if (!includesValue(folderValues, folder)) {
        addIssue(
          ctx,
          "CLOUDINARY_FOLDER_PREFIX",
          "Must be one of dev, preview, or prod",
        );
      } else if (folder !== expectedFolder(vercelEnv)) {
        addIssue(
          ctx,
          "CLOUDINARY_FOLDER_PREFIX",
          `Must be "${expectedFolder(vercelEnv)}" for the current environment`,
        );
      }
    }
  }

  // Resend group
  const resendKeys: KnownKey[] = [
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "INQUIRY_NOTIFICATION_FALLBACK",
  ];
  if (requireGroupTogether(ctx, raw, resendKeys)) {
    if (raw.EMAIL_FROM !== undefined) {
      checkEmail(ctx, "EMAIL_FROM", raw.EMAIL_FROM);
    }
    if (raw.INQUIRY_NOTIFICATION_FALLBACK !== undefined) {
      checkEmail(
        ctx,
        "INQUIRY_NOTIFICATION_FALLBACK",
        raw.INQUIRY_NOTIFICATION_FALLBACK,
      );
    }
  }

  // Upstash group
  const upstashKeys: KnownKey[] = [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "RATE_LIMIT_NAMESPACE",
  ];
  if (requireGroupTogether(ctx, raw, upstashKeys)) {
    if (raw.UPSTASH_REDIS_REST_URL !== undefined) {
      checkHttpsUrl(ctx, "UPSTASH_REDIS_REST_URL", raw.UPSTASH_REDIS_REST_URL);
    }
    const namespace = raw.RATE_LIMIT_NAMESPACE;
    if (namespace !== undefined) {
      if (!includesValue(namespaceValues, namespace)) {
        addIssue(
          ctx,
          "RATE_LIMIT_NAMESPACE",
          "Must be one of dev:, preview:, or prod:",
        );
      } else if (namespace !== expectedNamespace(vercelEnv)) {
        addIssue(
          ctx,
          "RATE_LIMIT_NAMESPACE",
          `Must be "${expectedNamespace(vercelEnv)}" for the current environment`,
        );
      }
    }
  }

  // CRON_SECRET
  if (raw.CRON_SECRET !== undefined) {
    if (raw.CRON_SECRET.length < 32) {
      addIssue(ctx, "CRON_SECRET", "Must contain at least 32 characters");
    }
    if (raw.AUTH_SECRET !== undefined && raw.CRON_SECRET === raw.AUTH_SECRET) {
      addIssue(ctx, "CRON_SECRET", "Must not be equal to AUTH_SECRET");
    }
    if (
      raw.IP_HASH_SECRET !== undefined &&
      raw.CRON_SECRET === raw.IP_HASH_SECRET
    ) {
      addIssue(ctx, "CRON_SECRET", "Must not be equal to IP_HASH_SECRET");
    }
  }

  // Sentry runtime group
  const sentryRuntimeKeys: KnownKey[] = [
    "SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_DSN",
    "SENTRY_ENVIRONMENT",
  ];
  if (requireGroupTogether(ctx, raw, sentryRuntimeKeys)) {
    if (raw.SENTRY_DSN !== undefined) {
      checkHttpsUrl(ctx, "SENTRY_DSN", raw.SENTRY_DSN);
    }
    if (raw.NEXT_PUBLIC_SENTRY_DSN !== undefined) {
      checkHttpsUrl(ctx, "NEXT_PUBLIC_SENTRY_DSN", raw.NEXT_PUBLIC_SENTRY_DSN);
    }
    const sentryEnv = raw.SENTRY_ENVIRONMENT;
    if (sentryEnv !== undefined) {
      if (!includesValue(sentryEnvValues, sentryEnv)) {
        addIssue(
          ctx,
          "SENTRY_ENVIRONMENT",
          "Must be development, preview, or production",
        );
      } else if (sentryEnv !== expectedSentryEnv(vercelEnv)) {
        addIssue(
          ctx,
          "SENTRY_ENVIRONMENT",
          `Must be "${expectedSentryEnv(vercelEnv)}" for the current environment`,
        );
      }
    }
  }

  // Seed credentials
  if (
    requireGroupTogether(ctx, raw, ["SEED_OWNER_EMAIL", "SEED_OWNER_PASSWORD"])
  ) {
    if (raw.SEED_OWNER_EMAIL !== undefined) {
      checkEmail(ctx, "SEED_OWNER_EMAIL", raw.SEED_OWNER_EMAIL);
    }
    if (
      raw.SEED_OWNER_PASSWORD !== undefined &&
      raw.SEED_OWNER_PASSWORD.length < 12
    ) {
      addIssue(
        ctx,
        "SEED_OWNER_PASSWORD",
        "Must contain at least 12 characters",
      );
    }
    if (vercelEnv === "production") {
      if (raw.SEED_OWNER_EMAIL !== undefined) {
        addIssue(
          ctx,
          "SEED_OWNER_EMAIL",
          "Must not be set when VERCEL_ENV is production",
        );
      }
      if (raw.SEED_OWNER_PASSWORD !== undefined) {
        addIssue(
          ctx,
          "SEED_OWNER_PASSWORD",
          "Must not be set when VERCEL_ENV is production",
        );
      }
    }
  }
}

function build(raw: RawEnv) {
  const vercelEnv = coerceEnum(vercelEnvValues, raw.VERCEL_ENV);
  const isDeployed = vercelEnv === "preview" || vercelEnv === "production";
  const localDefault = isDeployed ? undefined : LOCAL_DEFAULT_URL;

  return {
    NODE_ENV: coerceEnum(nodeEnvValues, raw.NODE_ENV) ?? "development",
    VERCEL_ENV: vercelEnv,
    NEXT_PUBLIC_APP_URL: raw.NEXT_PUBLIC_APP_URL ?? localDefault,
    APP_ORIGIN: raw.APP_ORIGIN ?? localDefault,
    DATABASE_URL: raw.DATABASE_URL,
    DIRECT_DATABASE_URL: raw.DIRECT_DATABASE_URL,
    AUTH_SECRET: raw.AUTH_SECRET,
    AUTH_URL: raw.AUTH_URL,
    IP_HASH_SECRET: raw.IP_HASH_SECRET,
    CLOUDINARY_CLOUD_NAME: raw.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: raw.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: raw.CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER_PREFIX: coerceEnum(
      folderValues,
      raw.CLOUDINARY_FOLDER_PREFIX,
    ),
    RESEND_API_KEY: raw.RESEND_API_KEY,
    EMAIL_FROM: raw.EMAIL_FROM,
    INQUIRY_NOTIFICATION_FALLBACK: raw.INQUIRY_NOTIFICATION_FALLBACK,
    UPSTASH_REDIS_REST_URL: raw.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: raw.UPSTASH_REDIS_REST_TOKEN,
    RATE_LIMIT_NAMESPACE: coerceEnum(namespaceValues, raw.RATE_LIMIT_NAMESPACE),
    CRON_SECRET: raw.CRON_SECRET,
    SENTRY_DSN: raw.SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_DSN: raw.NEXT_PUBLIC_SENTRY_DSN,
    SENTRY_ENVIRONMENT: coerceEnum(sentryEnvValues, raw.SENTRY_ENVIRONMENT),
    SENTRY_AUTH_TOKEN: raw.SENTRY_AUTH_TOKEN,
    SEED_OWNER_EMAIL: raw.SEED_OWNER_EMAIL,
    SEED_OWNER_PASSWORD: raw.SEED_OWNER_PASSWORD,
  };
}

const environmentSchema = z
  .record(z.string(), z.string().optional())
  .transform(normalize)
  .superRefine(validate)
  .transform(build);

/** A safe validation error that never contains supplied values or secrets. */
export class EnvironmentValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    const seen = new Set<string>();
    const deduped: Array<{ path: string; message: string }> = [];
    for (const issue of issues) {
      const key = `${issue.path}: ${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(issue);
      }
    }
    const body = deduped.map((i) => `- ${i.path}: ${i.message}`).join("\n");
    super(`Invalid environment configuration:\n${body}`);
    this.name = "EnvironmentValidationError";
    this.issues = deduped;
  }
}

/**
 * Validate an environment-like record and return the frozen, normalized
 * configuration. Throws {@link EnvironmentValidationError} on any problem.
 */
export function parseEnv(input: EnvironmentInput): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "(environment)",
      message: issue.message,
    }));
    throw new EnvironmentValidationError(issues);
  }
  return Object.freeze(result.data);
}
