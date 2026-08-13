import "server-only";

import { errors as upstashErrors } from "@upstash/redis";

import type { RateLimitDiagnosticCode } from "@/server/diagnostics/events";
import { IntegrationUnavailableError } from "@/server/integrations/errors";

/**
 * Classify a raw failure from the Upstash rate-limit boundary into a stable,
 * machine-readable code — without ever retaining or exposing the provider's
 * message, response body, URL, token, or Redis key.
 *
 * Classification inspects the *type* of the thrown error (the real classes
 * exported by `@upstash/redis`) and, only to derive a code, a narrow set of
 * error-name / message signals. The message itself is never stored or logged;
 * note the installed Upstash client embeds the Redis command (including the key)
 * in `UpstashError.message`, which is exactly why it must never be surfaced.
 */

const { UpstashError, UpstashJSONParseError, UrlError } = upstashErrors;

/** The provider-failure subset (never `RATE_LIMIT_EXCEEDED`, which is normal). */
export type RateLimitProviderCode = Exclude<
  RateLimitDiagnosticCode,
  "RATE_LIMIT_OK" | "RATE_LIMIT_EXCEEDED"
>;

const UNAUTHORIZED_SIGNAL =
  /\bunauthorized\b|\binvalid\s+(?:token|credential)|wrongpass|\bnoauth\b/i;
const FORBIDDEN_SIGNAL = /\bforbidden\b|permission denied|\bnoperm/i;
const NETWORK_CAUSE_CODE =
  /^(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR)/;

function errorName(error: unknown): string {
  return error instanceof Error && typeof error.name === "string"
    ? error.name
    : "";
}

function messageOf(error: unknown): string {
  return error instanceof Error && typeof error.message === "string"
    ? error.message
    : "";
}

function isTimeout(error: unknown): boolean {
  const name = errorName(error);
  return name === "AbortError" || name === "TimeoutError";
}

function isNetworkUnreachable(error: unknown): boolean {
  // Node/undici surface transport failures as a TypeError "fetch failed" whose
  // `cause` carries a syscall code. We read only the coarse code, never detail.
  if (error instanceof TypeError && /fetch failed/i.test(messageOf(error))) {
    return true;
  }
  const cause =
    error instanceof Error && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const causeCode =
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code?: unknown }).code === "string"
      ? (cause as { code: string }).code
      : "";
  return NETWORK_CAUSE_CODE.test(causeCode);
}

/**
 * Map a thrown provider error to a stable code. Ordering is deliberate: the
 * precise Upstash types win, then transport/timeout shapes, then auth signals,
 * with a generic provider fallback.
 */
export function classifyUpstashError(error: unknown): RateLimitProviderCode {
  if (error instanceof UrlError) return "RATE_LIMIT_CONFIGURATION_MISSING";
  if (error instanceof UpstashJSONParseError) {
    return "RATE_LIMIT_PROVIDER_RESPONSE_INVALID";
  }
  if (isTimeout(error)) return "RATE_LIMIT_PROVIDER_TIMEOUT";
  if (isNetworkUnreachable(error)) return "RATE_LIMIT_PROVIDER_UNREACHABLE";

  if (error instanceof UpstashError) {
    const message = messageOf(error);
    if (UNAUTHORIZED_SIGNAL.test(message)) {
      return "RATE_LIMIT_PROVIDER_UNAUTHORIZED";
    }
    if (FORBIDDEN_SIGNAL.test(message)) return "RATE_LIMIT_PROVIDER_FORBIDDEN";
    return "RATE_LIMIT_PROVIDER_ERROR";
  }

  return "RATE_LIMIT_PROVIDER_ERROR";
}

/**
 * A fail-closed rate-limiter provider failure that carries a stable diagnostic
 * code but no sensitive context. It extends {@link IntegrationUnavailableError}
 * so existing `instanceof` handling and the fail-closed policy are unchanged.
 */
export class RateLimitProviderError extends IntegrationUnavailableError {
  readonly diagnosticCode: RateLimitProviderCode;

  constructor(diagnosticCode: RateLimitProviderCode, cause?: unknown) {
    super(cause);
    this.name = "RateLimitProviderError";
    this.diagnosticCode = diagnosticCode;
  }
}

/** Extract the stable code from any rate-limiter failure, with a safe default. */
export function rateLimitCodeFrom(error: unknown): RateLimitProviderCode {
  if (error instanceof RateLimitProviderError) return error.diagnosticCode;
  return "RATE_LIMIT_PROVIDER_ERROR";
}
