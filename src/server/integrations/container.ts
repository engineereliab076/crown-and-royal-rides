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

function requireDeployedGroups(
  mode: IntegrationDeploymentMode,
  groups: readonly ProviderGroup[],
): void {
  if (mode !== "preview" && mode !== "production") return;
  const missing = groups
    .filter((group) => !groupIsComplete(group))
    .flatMap((group) => group.values.map(({ key }) => key));
  if (missing.length > 0) {
    throw new Error(
      `Real integrations are required in ${mode}. Missing: ${missing.join(", ")}.`,
    );
  }
}

export function createIntegrationContainer(
  environment: Environment,
  dependencies: IntegrationContainerDependencies = {},
): IntegrationContainer {
  const mode = deploymentMode(environment);
  if (mode === "test") {
    return Object.freeze({
      mediaStorage: new InMemoryMediaStorage(),
      emailSender: new InMemoryEmailSender(),
      rateLimiter: new InMemoryRateLimiter(),
      errorReporter: new InMemoryErrorReporter(),
      mode: Object.freeze({
        deployment: mode,
        providers: Object.freeze({
          mediaStorage: "in-memory",
          emailSender: "in-memory",
          rateLimiter: "in-memory",
          errorReporter: "in-memory",
        }),
      }),
    });
  }

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
  const groups = [cloudinaryGroup, resendGroup, upstashGroup, sentryGroup];
  requireDeployedGroups(mode, groups);

  const hasCloudinary = groupIsComplete(cloudinaryGroup);
  const hasResend = groupIsComplete(resendGroup);
  const hasUpstash = groupIsComplete(upstashGroup);
  const hasSentry = groupIsComplete(sentryGroup);

  const mediaStorage = hasCloudinary
    ? new CloudinaryMediaStorage(
        {
          cloudName: environment.CLOUDINARY_CLOUD_NAME as string,
          apiKey: environment.CLOUDINARY_API_KEY as string,
          apiSecret: environment.CLOUDINARY_API_SECRET as string,
          folderPrefix: environment.CLOUDINARY_FOLDER_PREFIX as string,
        },
        { client: dependencies.cloudinary },
      )
    : new InMemoryMediaStorage();
  const emailSender = hasResend
    ? new ResendEmailSender(
        {
          apiKey: environment.RESEND_API_KEY as string,
          from: environment.EMAIL_FROM as string,
        },
        dependencies.resend,
      )
    : new InMemoryEmailSender();
  const rateLimiter = hasUpstash
    ? new UpstashRateLimiter(
        {
          restUrl: environment.UPSTASH_REDIS_REST_URL as string,
          restToken: environment.UPSTASH_REDIS_REST_TOKEN as string,
          namespace: environment.RATE_LIMIT_NAMESPACE as string,
        },
        dependencies.upstashLimiterFactory,
      )
    : new InMemoryRateLimiter();
  const errorReporter = hasSentry
    ? new SentryErrorReporter(
        {
          dsn: environment.SENTRY_DSN as string,
          environment: environment.SENTRY_ENVIRONMENT as string,
          enabled: true,
          includeActorId: false,
        },
        dependencies.sentry,
      )
    : new InMemoryErrorReporter();

  return Object.freeze({
    mediaStorage,
    emailSender,
    rateLimiter,
    errorReporter,
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
