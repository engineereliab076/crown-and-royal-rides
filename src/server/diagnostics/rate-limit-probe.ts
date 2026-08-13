import "server-only";

import { createCorrelationId } from "@/lib/correlation";
import type { RateLimitDiagnosticCode } from "@/server/diagnostics/events";
import { rateLimitCodeFrom } from "@/server/integrations/rate-limiter/classify";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type { RateLimitPolicy } from "@/server/integrations/rate-limiter/types";

/**
 * Safe rate-limiter diagnostic probe.
 *
 * Performs the single minimal operation the login path depends on — one
 * consuming `check` against a dedicated, namespaced diagnostic key with a short
 * window — and reports only PASS/FAIL, a stable code, and the correlation ID. It
 * never reveals the URL, token, Redis key, response body, or any environment
 * value, and it never touches application or database data (the diagnostic key
 * is separate from every auth key and expires within the probe window).
 */

/** A short-lived, high-limit window: the probe checks reachability, not quota. */
const PROBE_POLICY: RateLimitPolicy = { limit: 1_000_000, windowMs: 10_000 };
const PROBE_KEY = "diagnostic:probe";

export interface RateLimitProbeResult {
  readonly ok: boolean;
  readonly code: RateLimitDiagnosticCode;
  readonly correlationId: string;
}

export interface RateLimitProbeDependencies {
  readonly rateLimiter: Pick<RateLimiter, "check">;
  /** Server-generated; supplied by the caller so the same ID appears in logs. */
  readonly correlationId?: string;
}

export async function runRateLimitProbe(
  deps: RateLimitProbeDependencies,
): Promise<RateLimitProbeResult> {
  const correlationId = deps.correlationId ?? createCorrelationId();
  try {
    // A well-formed decision (allowed or not) proves the client is configured,
    // reachable, and authorized. We deliberately ignore the decision itself.
    await deps.rateLimiter.check(PROBE_KEY, PROBE_POLICY);
    return { ok: true, code: "RATE_LIMIT_OK", correlationId };
  } catch (error) {
    return { ok: false, code: rateLimitCodeFrom(error), correlationId };
  }
}

/** Render the single safe result line: `PASS|FAIL <code> <correlationId>`. */
export function formatProbeLine(result: RateLimitProbeResult): string {
  return `${result.ok ? "PASS" : "FAIL"} ${result.code} ${result.correlationId}`;
}
