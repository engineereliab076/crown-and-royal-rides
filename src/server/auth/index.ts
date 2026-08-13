import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { createCorrelationId } from "@/lib/correlation";
import { buildLoginDiagnosticEvent } from "@/server/diagnostics/auth-events";
import { emitDiagnosticEvent } from "@/server/diagnostics/logger";
import { getClientIp } from "@/server/http/client-ip";
import {
  AuthenticationInternalFailure,
  AuthenticationUnavailable,
  RateLimitedSignin,
} from "@/server/auth/errors";
import {
  applyUserToToken,
  buildValidatedSession,
} from "@/server/auth/callbacks";
import { authEdgeConfig } from "@/server/auth/edge-config";
import { performLogin, type LoginDiagnostic } from "@/server/auth/login";
import {
  AuthRateLimiterConfigurationError,
  getAuthServices,
} from "@/server/auth/services";
import { getIntegrationContainer } from "@/server/integrations/container";
import { parseLoginCredentials } from "@/server/auth/credentials";

/**
 * Full (Node) Auth.js configuration.
 *
 * The Credentials provider validates input with the Group 1 login schema,
 * applies email + IP rate limiting, and delegates to the auth service. It
 * returns only the safe authenticated result and a single generic failure for
 * every rejection (unknown email, wrong password, inactive account, malformed
 * hash, invalid input). Credentials are never logged and internal AppError
 * details never surface to the client.
 */

/**
 * Resolve the error reporter for the separate (Sentry) diagnostic channel. This
 * is best-effort: a missing provider must never break authentication.
 */
function resolveErrorReporter() {
  try {
    return getIntegrationContainer().errorReporter;
  } catch {
    return undefined;
  }
}

/**
 * Emit exactly one safe diagnostic event for a classified login failure. Only
 * allow-listed, non-sensitive fields are logged; the single event is keyed by
 * the attempt's correlation ID so an operator can find it from the reference
 * shown to the user.
 */
function reportAuthenticationFailure(
  correlationId: string,
  diagnostic: LoginDiagnostic,
): void {
  emitDiagnosticEvent(buildLoginDiagnosticEvent(correlationId, diagnostic), {
    reporter: resolveErrorReporter(),
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authEdgeConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        // One server-generated correlation ID for the whole attempt. It is never
        // taken from the browser; it flows to the single diagnostic event and to
        // the reference shown in the safe UI result.
        const correlationId = createCorrelationId();
        const reportFailure = (diagnostic: LoginDiagnostic) =>
          reportAuthenticationFailure(correlationId, diagnostic);

        // Auth.js delivers the whole sign-in body here and always appends a
        // `callbackUrl` control field, so validate only the credential fields
        // rather than passing the whole body to the strict login schema. Passing
        // the whole body rejects every real submission as malformed input and
        // surfaces it as a generic CredentialsSignin before verification runs.
        // Malformed input is a client-side rejection (stays generic, no event).
        const parsed = parseLoginCredentials(credentials);
        if (parsed === null) return null;

        const { email, password } = parsed;

        let authServices;
        try {
          authServices = getAuthServices();
        } catch (error) {
          if (error instanceof AuthRateLimiterConfigurationError) {
            reportFailure({
              stage: "auth.services",
              code: "RATE_LIMIT_CONFIGURATION_MISSING",
              severity: "error",
              // Names only (never values), so the real gap is visible in logs —
              // e.g. IP_HASH_SECRET rather than the already-present Upstash vars.
              ...(error.missing.length > 0 ? { missing: error.missing } : {}),
            });
            throw new AuthenticationUnavailable(correlationId);
          }
          reportFailure({
            stage: "auth.services",
            code: "AUTH_SERVICES_UNAVAILABLE",
            severity: "error",
          });
          throw new AuthenticationInternalFailure(correlationId);
        }

        let ip: string | null;
        try {
          ip = getClientIp(request.headers);
        } catch {
          reportFailure({
            stage: "auth.client_ip",
            code: "AUTH_CLIENT_IP_INVALID",
            severity: "error",
          });
          throw new AuthenticationInternalFailure(correlationId);
        }

        // Ordering and counting live in performLogin: IP consumed before Argon2
        // (bounds all attempts, fail-closed), email failure allowance consumed
        // only on a failed verification (successes never spend it).
        let outcome;
        try {
          outcome = await performLogin(
            { email, password, ip },
            { ...authServices, reportFailure },
          );
        } catch {
          // performLogin already emitted the single PII-free diagnostic event.
          throw new AuthenticationInternalFailure(correlationId);
        }

        if (outcome.status === "rate_limited") {
          // Lockout / fail-closed: distinguishable code, no account disclosure.
          throw new RateLimitedSignin();
        }
        if (outcome.status === "rate_limiter_unavailable") {
          // performLogin already emitted the provider diagnostic; surface only
          // the correlation ID so the safe UI reference matches the log event.
          throw new AuthenticationUnavailable(correlationId);
        }
        if (outcome.status === "invalid") {
          // Generic failure: never expose AppError details or credentials.
          return null;
        }

        const { admin } = outcome;
        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          sessionVersion: admin.sessionVersion,
          mustChangePassword: admin.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...authEdgeConfig.callbacks,
    jwt({ token, user }) {
      if (user) return applyUserToToken(token, user);
      return token;
    },
    async session({ session, token }) {
      const { authService } = getAuthServices();
      return buildValidatedSession(session, token, authService);
    },
  },
});
