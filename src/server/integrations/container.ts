import "server-only";

import { env, type Environment } from "@/lib/env";
import { InMemoryEmailSender } from "@/server/integrations/email-sender/in-memory";
import type { EmailSender } from "@/server/integrations/email-sender/interface";
import {
  ResendEmailSender,
  type ResendFacade,
} from "@/server/integrations/email-sender/resend";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import {
  SentryErrorReporter,
  type SentryFacade,
} from "@/server/integrations/error-reporter/sentry";
import {
  CloudinaryMediaStorage,
  type CloudinaryFacade,
} from "@/server/integrations/media-storage/cloudinary";
import { InMemoryMediaStorage } from "@/server/integrations/media-storage/in-memory";
import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import { InMemoryRateLimiter } from "@/server/integrations/rate-limiter/in-memory";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import {
  UpstashRateLimiter,
  type UpstashLimiterFactory,
} from "@/server/integrations/rate-limiter/upstash";

export type IntegrationDeploymentMode =
  "test" | "local" | "preview" | "production";

export interface IntegrationModeDescriptor {
  readonly deployment: IntegrationDeploymentMode;
  readonly providers: Readonly<{
    mediaStorage: "in-memory" | "cloudinary";
    emailSender: "in-memory" | "resend";
    rateLimiter: "in-memory" | "upstash";
    errorReporter: "in-memory" | "sentry";
  }>;
}

export interface IntegrationContainer {
  readonly mediaStorage: MediaStorage;
  readonly emailSender: EmailSender;
  readonly rateLimiter: RateLimiter;
  readonly errorReporter: ErrorReporter;
  readonly mode: IntegrationModeDescriptor;
}

export interface IntegrationContainerDependencies {
  readonly cloudinary?: CloudinaryFacade;
  readonly resend?: ResendFacade;
  readonly upstashLimiterFactory?: UpstashLimiterFactory;
  readonly sentry?: SentryFacade;
}

type ProviderGroup = Readonly<{
  name: string;
  values: ReadonlyArray<Readonly<{ key: string; value: string | undefined }>>;
}>;

function deploymentMode(environment: Environment): IntegrationDeploymentMode {
  if (environment.NODE_ENV === "test") return "test";
  if (environment.VERCEL_ENV === "preview") return "preview";
  if (environment.VERCEL_ENV === "production") return "production";
  return "local";
}

function groupIsComplete(group: ProviderGroup): boolean {
  const missing = group.values
    .filter(({ value }) => value === undefined)
    .map(({ key }) => key);
  if (missing.length === group.values.length) return false;
  if (missing.length > 0) {
    throw new Error(
      `Incomplete ${group.name} integration configuration. Missing: ${missing.join(", ")}.`,
    );
  }
  return true;
}

function missingConfigError(
  mode: IntegrationDeploymentMode,
  group: ProviderGroup,
): Error {
  const missing = group.values
    .filter(({ value }) => value === undefined)
    .map(({ key }) => key);
  return new Error(
    `Real integrations are required in ${mode}. Missing: ${missing.join(", ")}.`,
  );
}

/**
 * Compose the integration container.
 *
 * Each of the four integrations is resolved **independently and lazily**:
 * accessing (say) `errorReporter` initializes only the Sentry adapter and never
 * touches Cloudinary, Resend, or Upstash. Provider SDK clients are therefore
 * constructed on first request, not at import time, so importing an admin route
 * and collecting page data during `next build` never requires unrelated
 * provider credentials.
 *
 * Production safety is preserved per integration: requesting a specific real
 * integration whose configuration is absent in Preview/Production throws a safe,
 * value-free error (never a silent in-memory fallback). In local development an
 * absent group falls back to its in-memory double; a *partially* configured
 * group is a configuration error and is rejected eagerly (below).
 */
export function createIntegrationContainer(
  environment: Environment,
  dependencies: IntegrationContainerDependencies = {},
): IntegrationContainer {
  const mode = deploymentMode(environment);
  const isDeployed = mode === "preview" || mode === "production";

  const cloudinaryGroup: ProviderGroup = {
    name: "Cloudinary",
    values: [
      {
        key: "CLOUDINARY_CLOUD_NAME",
        value: environment.CLOUDINARY_CLOUD_NAME,
      },
      { key: "CLOUDINARY_API_KEY", value: environment.CLOUDINARY_API_KEY },
      {
        key: "CLOUDINARY_API_SECRET",
        value: environment.CLOUDINARY_API_SECRET,
      },
      {
        key: "CLOUDINARY_FOLDER_PREFIX",
        value: environment.CLOUDINARY_FOLDER_PREFIX,
      },
    ],
  };
  const resendGroup: ProviderGroup = {
    name: "Resend",
    values: [
      { key: "RESEND_API_KEY", value: environment.RESEND_API_KEY },
      { key: "EMAIL_FROM", value: environment.EMAIL_FROM },
      {
        key: "INQUIRY_NOTIFICATION_FALLBACK",
        value: environment.INQUIRY_NOTIFICATION_FALLBACK,
      },
    ],
  };
  const upstashGroup: ProviderGroup = {
    name: "Upstash",
    values: [
      {
        key: "UPSTASH_REDIS_REST_URL",
        value: environment.UPSTASH_REDIS_REST_URL,
      },
      {
        key: "UPSTASH_REDIS_REST_TOKEN",
        value: environment.UPSTASH_REDIS_REST_TOKEN,
      },
      { key: "RATE_LIMIT_NAMESPACE", value: environment.RATE_LIMIT_NAMESPACE },
    ],
  };
  const sentryGroup: ProviderGroup = {
    name: "Sentry",
    values: [
      { key: "SENTRY_DSN", value: environment.SENTRY_DSN },
      {
        key: "NEXT_PUBLIC_SENTRY_DSN",
        value: environment.NEXT_PUBLIC_SENTRY_DSN,
      },
      { key: "SENTRY_ENVIRONMENT", value: environment.SENTRY_ENVIRONMENT },
    ],
  };

  // Completeness is computed once for the (cheap, adapter-free) mode descriptor.
  // Test mode always uses in-memory doubles. `groupIsComplete` returns false for
  // a wholly-absent group but throws for a *partial* group — a configuration
  // error surfaced eagerly regardless of which integration is requested later.
  const hasCloudinary = mode !== "test" && groupIsComplete(cloudinaryGroup);
  const hasResend = mode !== "test" && groupIsComplete(resendGroup);
  const hasUpstash = mode !== "test" && groupIsComplete(upstashGroup);
  const hasSentry = mode !== "test" && groupIsComplete(sentryGroup);

  // Memoized lazy resolvers. Each touches only its own provider group, so
  // requesting one integration never initializes another.
  let mediaStorage: MediaStorage | undefined;
  let emailSender: EmailSender | undefined;
  let rateLimiter: RateLimiter | undefined;
  let errorReporter: ErrorReporter | undefined;

  function resolveMediaStorage(): MediaStorage {
    if (hasCloudinary) {
      return new CloudinaryMediaStorage(
        {
          cloudName: environment.CLOUDINARY_CLOUD_NAME as string,
          apiKey: environment.CLOUDINARY_API_KEY as string,
          apiSecret: environment.CLOUDINARY_API_SECRET as string,
          folderPrefix: environment.CLOUDINARY_FOLDER_PREFIX as string,
        },
        { client: dependencies.cloudinary },
      );
    }
    if (isDeployed) throw missingConfigError(mode, cloudinaryGroup);
    return new InMemoryMediaStorage();
  }

  function resolveEmailSender(): EmailSender {
    if (hasResend) {
      return new ResendEmailSender(
        {
          apiKey: environment.RESEND_API_KEY as string,
          from: environment.EMAIL_FROM as string,
        },
        dependencies.resend,
      );
    }
    if (isDeployed) throw missingConfigError(mode, resendGroup);
    return new InMemoryEmailSender();
  }

  function resolveRateLimiter(): RateLimiter {
    if (hasUpstash) {
      return new UpstashRateLimiter(
        {
          restUrl: environment.UPSTASH_REDIS_REST_URL as string,
          restToken: environment.UPSTASH_REDIS_REST_TOKEN as string,
          namespace: environment.RATE_LIMIT_NAMESPACE as string,
        },
        dependencies.upstashLimiterFactory,
      );
    }
    if (isDeployed) throw missingConfigError(mode, upstashGroup);
    return new InMemoryRateLimiter();
  }

  function resolveErrorReporter(): ErrorReporter {
    if (hasSentry) {
      return new SentryErrorReporter(
        {
          dsn: environment.SENTRY_DSN as string,
          environment: environment.SENTRY_ENVIRONMENT as string,
          enabled: true,
          includeActorId: false,
        },
        dependencies.sentry,
      );
    }
    if (isDeployed) throw missingConfigError(mode, sentryGroup);
    return new InMemoryErrorReporter();
  }

  return Object.freeze<IntegrationContainer>({
    get mediaStorage() {
      return (mediaStorage ??= resolveMediaStorage());
    },
    get emailSender() {
      return (emailSender ??= resolveEmailSender());
    },
    get rateLimiter() {
      return (rateLimiter ??= resolveRateLimiter());
    },
    get errorReporter() {
      return (errorReporter ??= resolveErrorReporter());
    },
    mode: Object.freeze({
      deployment: mode,
      providers: Object.freeze({
        mediaStorage: hasCloudinary ? "cloudinary" : "in-memory",
        emailSender: hasResend ? "resend" : "in-memory",
        rateLimiter: hasUpstash ? "upstash" : "in-memory",
        errorReporter: hasSentry ? "sentry" : "in-memory",
      }),
    }),
  });
}

let singleton: IntegrationContainer | undefined;

export function getIntegrationContainer(): IntegrationContainer {
  singleton ??= createIntegrationContainer(env);
  return singleton;
}

export function resetIntegrationContainerForTests(): void {
  if (env.NODE_ENV !== "test") {
    throw new Error("The integration container can only be reset in tests.");
  }
  singleton = undefined;
}
