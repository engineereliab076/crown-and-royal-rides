import "server-only";

import type {
  DiagnosticCode,
  DiagnosticSeverity,
  DiagnosticStage,
} from "@/server/diagnostics/events";
import { isAppError } from "@/server/http/errors";
import { rateLimitCodeFrom } from "@/server/integrations/rate-limiter/classify";
import type { AuthRateLimiter } from "@/server/modules/auth/rate-limit";
import type {
  AuthenticatedAdmin,
  AuthService,
} from "@/server/modules/auth/service";

/**
 * Login orchestration, extracted from the Auth.js `authorize` callback so the
 * rate-limit counting order can be unit-tested deterministically.
 *
 * Ordering (see {@link AuthRateLimiter}):
 *  1. Consume the per-IP allowance BEFORE the expensive Argon2 verification, so
 *     every attempt is bounded and a locked/failed limiter short-circuits work.
 *  2. Verify credentials.
 *  3. On failure only, consume the per-email failure allowance. A successful
 *     login never touches the email counter, so repeated successes cannot lock
 *     an account.
 *
 * Unknown-email and wrong-password failures are indistinguishable: both raise
 * the same generic verification error and consume one email failure allowance.
 * A rate-limiter provider outage is surfaced by the rate limiter as a denied
 * decision (fail-closed), which prevents credential verification.
 */

export type LoginOutcome =
  | { readonly status: "ok"; readonly admin: AuthenticatedAdmin }
  | { readonly status: "invalid" }
  | { readonly status: "rate_limited" }
  | { readonly status: "rate_limiter_unavailable" };

/**
 * A safe, structured diagnostic describing a non-credential failure. It carries
 * only an allow-listed stage, a stable code, and a severity — never credentials,
 * identifiers, or raw error content.
 */
export interface LoginDiagnostic {
  readonly stage: DiagnosticStage;
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
}

export type LoginFailureReporter = (
  diagnostic: LoginDiagnostic,
) => void | Promise<void>;

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly ip: string | null;
}

export interface LoginDependencies {
  readonly authService: Pick<AuthService, "verifyCredentials" | "recordLogin">;
  readonly authRateLimiter: Pick<
    AuthRateLimiter,
    "checkLoginIp" | "recordLoginFailure"
  >;
  /** PII-free, best-effort reporting of non-credential failures. */
  readonly reportFailure?: LoginFailureReporter;
}

async function reportSafely(
  reporter: LoginFailureReporter | undefined,
  diagnostic: LoginDiagnostic,
): Promise<void> {
  try {
    await reporter?.(diagnostic);
  } catch {
    // Diagnostics must never change an authentication outcome.
  }
}

function providerUnavailable(
  stage: DiagnosticStage,
  code: DiagnosticCode,
): LoginDiagnostic {
  return { stage, code, severity: "error" };
}

export async function performLogin(
  input: LoginInput,
  deps: LoginDependencies,
): Promise<LoginOutcome> {
  const { authService, authRateLimiter } = deps;

  // 1) Per-IP gate BEFORE Argon2 (counts every attempt; fail-closed on outage).
  let ipDecision;
  try {
    ipDecision = await authRateLimiter.checkLoginIp(input.ip);
  } catch (error) {
    await reportSafely(
      deps.reportFailure,
      providerUnavailable("auth.rate_limit.ip", rateLimitCodeFrom(error)),
    );
    return { status: "rate_limiter_unavailable" };
  }
  if (!ipDecision.allowed) {
    if (ipDecision.reason === "unavailable") {
      await reportSafely(
        deps.reportFailure,
        providerUnavailable("auth.rate_limit.ip", ipDecision.code),
      );
      return { status: "rate_limiter_unavailable" };
    }
    return { status: "rate_limited" };
  }

  // 2) Verify credentials (Argon2). Unknown email, wrong password, inactive
  //    account, and malformed hash all raise the same generic error.
  let admin: AuthenticatedAdmin;
  try {
    admin = await authService.verifyCredentials({
      email: input.email,
      password: input.password,
    });
  } catch (error) {
    if (!isAppError(error) || error.code !== "AUTH_INVALID_CREDENTIALS") {
      await reportSafely(deps.reportFailure, {
        stage: "auth.verify",
        code: "AUTH_UNEXPECTED_INTERNAL",
        severity: "error",
      });
      throw error;
    }

    // 3) Failed attempt → consume the per-email FAILURE allowance only.
    let emailDecision;
    try {
      emailDecision = await authRateLimiter.recordLoginFailure(input.email);
    } catch (limiterError) {
      await reportSafely(
        deps.reportFailure,
        providerUnavailable(
          "auth.rate_limit.email",
          rateLimitCodeFrom(limiterError),
        ),
      );
      return { status: "rate_limiter_unavailable" };
    }
    if (emailDecision.allowed) return { status: "invalid" };
    if (emailDecision.reason === "unavailable") {
      await reportSafely(
        deps.reportFailure,
        providerUnavailable("auth.rate_limit.email", emailDecision.code),
      );
      return { status: "rate_limiter_unavailable" };
    }
    return { status: "rate_limited" };
  }

  // 4) Success → the email failure counter is never consumed.
  try {
    await authService.recordLogin(admin.id);
  } catch {
    // Best-effort; a failed timestamp write must never block login.
    await reportSafely(deps.reportFailure, {
      stage: "auth.bookkeeping",
      code: "AUTH_BOOKKEEPING_DEGRADED",
      severity: "warning",
    });
  }
  return { status: "ok", admin };
}
