import "server-only";

import { isValidCorrelationId } from "@/lib/correlation";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import {
  isDiagnosticCode,
  isDiagnosticSeverity,
  isDiagnosticStage,
  serializeDiagnosticEvent,
  type SafeDiagnosticEvent,
} from "@/server/diagnostics/events";

/**
 * Safe server diagnostic logger.
 *
 * Emits exactly one single-line structured JSON event per failure through a
 * narrowly scoped sink (default `console.info`), searchable in Vercel by the
 * correlation ID or the stable code. The raw error is never written to the log:
 * only allow-listed, machine-readable fields validated against the event
 * contract reach the output.
 *
 * The optional error reporter is a *separate* channel: it receives the same
 * stable code and correlation ID as a captured message (for Sentry search), but
 * still never the raw error object, request, or provider response. Both sinks
 * are best-effort — a logging failure can never change authentication handling.
 */

export interface DiagnosticSink {
  info(line: string): void;
}

const defaultSink: DiagnosticSink = {
  info: (line) => {
    // Single safe line only; never `console.error(rawError)` which could carry
    // request or provider details.
    console.info(line);
  },
};

export interface EmitDiagnosticOptions {
  /** Existing reporting boundary; receives the stable code, never a raw error. */
  readonly reporter?: ErrorReporter;
  /** Overridable sink (tests inject a capture; production uses console.info). */
  readonly sink?: DiagnosticSink;
}

function isEmittable(event: SafeDiagnosticEvent): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    isValidCorrelationId(event.correlationId) &&
    isDiagnosticCode(event.code) &&
    isDiagnosticStage(event.stage) &&
    isDiagnosticSeverity(event.severity)
  );
}

export function emitDiagnosticEvent(
  event: SafeDiagnosticEvent,
  options: EmitDiagnosticOptions = {},
): void {
  try {
    if (!isEmittable(event)) return;

    (options.sink ?? defaultSink).info(serializeDiagnosticEvent(event));

    const reporter = options.reporter;
    if (reporter !== undefined) {
      try {
        reporter.captureMessage(event.code, event.severity, {
          correlationId: event.correlationId,
          ...(event.route !== undefined ? { route: event.route } : {}),
          ...(event.method !== undefined ? { method: event.method } : {}),
          additional: {
            stage: event.stage,
            ...(event.integration !== undefined
              ? { integration: event.integration }
              : {}),
            ...(event.safeStatus !== undefined
              ? { safeStatus: event.safeStatus }
              : {}),
          },
        });
      } catch {
        // The Sentry channel is best-effort and never affects the request.
      }
    }
  } catch {
    // Diagnostics must never break request handling.
  }
}
