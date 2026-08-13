import "server-only";

import type { LoginDiagnostic } from "@/server/auth/login";
import {
  safeStatusForCode,
  type DiagnosticStage,
  type SafeDiagnosticEvent,
} from "@/server/diagnostics/events";

/**
 * Build the single safe diagnostic event for a classified login failure.
 *
 * This is a pure mapping from the server-generated correlation ID plus a
 * {@link LoginDiagnostic} to a {@link SafeDiagnosticEvent}: only allow-listed,
 * non-sensitive fields are produced. The same correlation ID is later surfaced
 * to the user as an opaque support reference, so the visible reference and the
 * logged event always match.
 */

export const AUTH_CALLBACK_ROUTE = "/api/admin/auth/callback/credentials";
export const AUTH_CALLBACK_METHOD = "POST";

const RATE_LIMIT_STAGES: ReadonlySet<DiagnosticStage> = new Set([
  "auth.rate_limit.ip",
  "auth.rate_limit.email",
]);

export function buildLoginDiagnosticEvent(
  correlationId: string,
  diagnostic: LoginDiagnostic,
  now: () => Date = () => new Date(),
): SafeDiagnosticEvent {
  const safeStatus = safeStatusForCode(diagnostic.code);
  return {
    correlationId,
    code: diagnostic.code,
    stage: diagnostic.stage,
    severity: diagnostic.severity,
    route: AUTH_CALLBACK_ROUTE,
    method: AUTH_CALLBACK_METHOD,
    ...(RATE_LIMIT_STAGES.has(diagnostic.stage)
      ? { integration: "rate_limiter" as const }
      : {}),
    ...(safeStatus !== undefined ? { safeStatus } : {}),
    timestamp: now().toISOString(),
  };
}
