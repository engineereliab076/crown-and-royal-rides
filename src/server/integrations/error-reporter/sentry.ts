import "server-only";

import * as Sentry from "@sentry/nextjs";

import { copyErrorReportContext } from "@/server/integrations/error-reporter/context";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type {
  ErrorReportContext,
  ErrorReportLevel,
  ErrorReportValue,
} from "@/server/integrations/error-reporter/types";

export interface SentryErrorReporterConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
  readonly enabled: boolean;
  readonly includeActorId?: boolean;
}

export interface SentryScopeFacade {
  setTag(key: string, value: string): void;
  setContext(name: string, context: Record<string, unknown> | null): void;
}

export interface SentryFacade {
  withIsolationScope(callback: (scope: SentryScopeFacade) => void): void;
  captureException(error: unknown): unknown;
  captureMessage(
    message: string,
    options: { level: ErrorReportLevel },
  ): unknown;
}

const LEVELS: readonly ErrorReportLevel[] = [
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
];
const UNSAFE_ADDITIONAL_KEY =
  /inquiry|message|body|content|recipient|email|phone|address/i;

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function sanitizeRoute(route: string): string {
  const normalized = required(route, "route").split(/[?#]/, 1)[0]?.trim();
  if (normalized === undefined || normalized.length === 0) return "<unknown>";
  return normalized;
}

function assertSafeAdditional(value: ErrorReportValue): void {
  if (Array.isArray(value)) {
    for (const nested of value) assertSafeAdditional(nested);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_ADDITIONAL_KEY.test(key)) {
      throw new TypeError(
        "Error-report context contains unsafe personal data.",
      );
    }
    assertSafeAdditional(nested);
  }
}

function defaultFacade(): SentryFacade {
  return {
    withIsolationScope: (callback) => Sentry.withIsolationScope(callback),
    captureException: (error) => Sentry.captureException(error),
    captureMessage: (message, options) =>
      Sentry.captureMessage(message, options),
  };
}

export class SentryErrorReporter implements ErrorReporter {
  readonly #enabled: boolean;
  readonly #includeActorId: boolean;
  readonly #client: SentryFacade;

  constructor(
    config: SentryErrorReporterConfig,
    client: SentryFacade = defaultFacade(),
  ) {
    if (typeof config !== "object" || config === null) {
      throw new TypeError("Sentry configuration must be an object.");
    }
    required(config.dsn, "Sentry dsn");
    required(config.environment, "Sentry environment");
    if (config.release !== undefined)
      required(config.release, "Sentry release");
    if (typeof config.enabled !== "boolean") {
      throw new TypeError("Sentry enabled must be a boolean.");
    }
    this.#enabled = config.enabled;
    this.#includeActorId = config.includeActorId ?? false;
    this.#client = client;
  }

  captureException(error: unknown, context: ErrorReportContext): void {
    const normalized = this.#normalizeContext(context);
    if (!this.#enabled) return;
    try {
      this.#captureWithContext(normalized, () => {
        this.#client.captureException(error);
      });
    } catch {
      // Reporting is best-effort and must not interfere with the application.
    }
  }

  captureMessage(
    message: string,
    level: ErrorReportLevel,
    context: ErrorReportContext,
  ): void {
    const normalizedMessage = required(message, "Reported message");
    if (!LEVELS.includes(level)) {
      throw new TypeError("Reported message level is invalid.");
    }
    const normalized = this.#normalizeContext(context);
    if (!this.#enabled) return;
    try {
      this.#captureWithContext(normalized, () => {
        this.#client.captureMessage(normalizedMessage, { level });
      });
    } catch {
      // Reporting is best-effort and must not interfere with the application.
    }
  }

  #normalizeContext(context: ErrorReportContext): ErrorReportContext {
    const copied = copyErrorReportContext(context);
    if (copied.additional !== undefined) {
      assertSafeAdditional(copied.additional);
    }
    return Object.freeze({
      correlationId: copied.correlationId,
      ...(this.#includeActorId && copied.actorId !== undefined
        ? { actorId: copied.actorId }
        : {}),
      ...(copied.route === undefined
        ? {}
        : { route: sanitizeRoute(copied.route) }),
      ...(copied.method === undefined
        ? {}
        : { method: required(copied.method, "method").toUpperCase() }),
      ...(copied.additional === undefined
        ? {}
        : { additional: copied.additional }),
    });
  }

  #captureWithContext(context: ErrorReportContext, capture: () => void): void {
    this.#client.withIsolationScope((scope) => {
      scope.setTag("correlationId", context.correlationId);
      if (context.actorId !== undefined) {
        scope.setTag("actorId", context.actorId);
      }
      if (context.route !== undefined || context.method !== undefined) {
        scope.setContext("request", {
          ...(context.route === undefined ? {} : { route: context.route }),
          ...(context.method === undefined ? {} : { method: context.method }),
        });
      }
      if (context.additional !== undefined) {
        scope.setContext("additional", context.additional);
      }
      capture();
    });
  }
}
