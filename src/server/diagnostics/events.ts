import "server-only";

/**
 * Safe production diagnostic event contract.
 *
 * A diagnostic event describes *where* and *what kind* of failure occurred using
 * only fixed, allow-listed vocabulary — never free-form text drawn from a
 * request, a thrown error, or a provider response. Every field is a stable enum,
 * a server-generated correlation ID, or a machine-derived coarse status, so a
 * serialized event can never carry an email, password, hash, IP address, cookie,
 * token, URL, Redis key, provider message, or stack trace.
 *
 * Events are emitted through {@link emitDiagnosticEvent}; this module only owns
 * the vocabulary and a strict serializer.
 */

export type DiagnosticSeverity = "info" | "warning" | "error";

/** Fixed, allow-listed stage names for the login/rate-limit attempt path. */
export type DiagnosticStage =
  | "auth.services"
  | "auth.client_ip"
  | "auth.rate_limit.ip"
  | "auth.rate_limit.email"
  | "auth.verify"
  | "auth.bookkeeping"
  | "ratelimit.probe";

/** Stable machine-readable codes for the rate-limit boundary. */
export type RateLimitDiagnosticCode =
  | "RATE_LIMIT_OK"
  | "RATE_LIMIT_EXCEEDED"
  | "RATE_LIMIT_CONFIGURATION_MISSING"
  | "RATE_LIMIT_PROVIDER_UNAUTHORIZED"
  | "RATE_LIMIT_PROVIDER_FORBIDDEN"
  | "RATE_LIMIT_PROVIDER_TIMEOUT"
  | "RATE_LIMIT_PROVIDER_UNREACHABLE"
  | "RATE_LIMIT_PROVIDER_RESPONSE_INVALID"
  | "RATE_LIMIT_PROVIDER_ERROR";

/** Stable machine-readable codes for the surrounding auth flow. */
export type AuthDiagnosticCode =
  | "AUTH_SERVICES_UNAVAILABLE"
  | "AUTH_CLIENT_IP_INVALID"
  | "AUTH_UNEXPECTED_INTERNAL"
  | "AUTH_BOOKKEEPING_DEGRADED";

export type DiagnosticCode = RateLimitDiagnosticCode | AuthDiagnosticCode;

/** The external system a stage interacts with, when relevant. */
export type DiagnosticIntegration = "rate_limiter";

export interface SafeDiagnosticEvent {
  readonly correlationId: string;
  readonly code: DiagnosticCode;
  readonly stage: DiagnosticStage;
  readonly severity: DiagnosticSeverity;
  readonly route?: string;
  readonly method?: string;
  readonly integration?: DiagnosticIntegration;
  /** Coarse, machine-derived status class (never a raw provider status/body). */
  readonly safeStatus?: number;
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: string;
}

export const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  "info",
  "warning",
  "error",
];

export const DIAGNOSTIC_STAGES: readonly DiagnosticStage[] = [
  "auth.services",
  "auth.client_ip",
  "auth.rate_limit.ip",
  "auth.rate_limit.email",
  "auth.verify",
  "auth.bookkeeping",
  "ratelimit.probe",
];

export const DIAGNOSTIC_CODES: readonly DiagnosticCode[] = [
  "RATE_LIMIT_OK",
  "RATE_LIMIT_EXCEEDED",
  "RATE_LIMIT_CONFIGURATION_MISSING",
  "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
  "RATE_LIMIT_PROVIDER_FORBIDDEN",
  "RATE_LIMIT_PROVIDER_TIMEOUT",
  "RATE_LIMIT_PROVIDER_UNREACHABLE",
  "RATE_LIMIT_PROVIDER_RESPONSE_INVALID",
  "RATE_LIMIT_PROVIDER_ERROR",
  "AUTH_SERVICES_UNAVAILABLE",
  "AUTH_CLIENT_IP_INVALID",
  "AUTH_UNEXPECTED_INTERNAL",
  "AUTH_BOOKKEEPING_DEGRADED",
];

const DIAGNOSTIC_INTEGRATIONS: readonly DiagnosticIntegration[] = [
  "rate_limiter",
];

/**
 * Coarse, non-sensitive status class for a subset of codes. This is derived
 * purely from the stable code (never read from a provider response), so it can
 * never leak a real provider status or body.
 */
const SAFE_STATUS_BY_CODE: Partial<Record<DiagnosticCode, number>> = {
  RATE_LIMIT_PROVIDER_UNAUTHORIZED: 401,
  RATE_LIMIT_PROVIDER_FORBIDDEN: 403,
  RATE_LIMIT_PROVIDER_TIMEOUT: 408,
  RATE_LIMIT_PROVIDER_UNREACHABLE: 503,
  RATE_LIMIT_PROVIDER_RESPONSE_INVALID: 502,
};

export function isDiagnosticSeverity(
  value: unknown,
): value is DiagnosticSeverity {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_SEVERITIES.includes(value as DiagnosticSeverity)
  );
}

export function isDiagnosticStage(value: unknown): value is DiagnosticStage {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_STAGES.includes(value as DiagnosticStage)
  );
}

export function isDiagnosticCode(value: unknown): value is DiagnosticCode {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_CODES.includes(value as DiagnosticCode)
  );
}

export function isDiagnosticIntegration(
  value: unknown,
): value is DiagnosticIntegration {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_INTEGRATIONS.includes(value as DiagnosticIntegration)
  );
}

/** The coarse safe status for a code, if one is defined. */
export function safeStatusForCode(code: DiagnosticCode): number | undefined {
  return SAFE_STATUS_BY_CODE[code];
}

/**
 * Serialize an event to a single-line JSON string containing *only* the
 * allow-listed fields. Any unexpected field on the input is dropped, and any
 * field failing validation is omitted — the output can never carry stray data.
 */
export function serializeDiagnosticEvent(event: SafeDiagnosticEvent): string {
  const safe: Record<string, string | number> = {
    evt: "diagnostic",
    correlationId: event.correlationId,
    code: event.code,
    stage: event.stage,
    severity: event.severity,
    timestamp: event.timestamp,
  };
  if (typeof event.route === "string" && event.route.length > 0) {
    safe.route = event.route;
  }
  if (typeof event.method === "string" && event.method.length > 0) {
    safe.method = event.method;
  }
  if (isDiagnosticIntegration(event.integration)) {
    safe.integration = event.integration;
  }
  if (Number.isSafeInteger(event.safeStatus)) {
    safe.safeStatus = event.safeStatus as number;
  }
  return JSON.stringify(safe);
}
