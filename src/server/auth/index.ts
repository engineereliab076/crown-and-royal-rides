import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { createCorrelationId } from "@/lib/correlation";
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
import { performLogin } from "@/server/auth/login";
import {
  AuthRateLimiterConfigurationError,
  getAuthServices,
} from "@/server/auth/services";
import { getIntegrationContainer } from "@/server/integrations/container";
import type { LoginFailureClassification } from "@/server/auth/login";
import { loginCredentialsSchema } from "@/server/modules/auth/schemas";

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

async function reportAuthenticationFailure(
  correlationId: string,
  classification: LoginFailureClassification,
): Promise<void> {
  try {
    await getIntegrationContainer().errorReporter.captureMessage(
      "Authentication failure classified.",
      classification === "unexpected_internal" ? "error" : "warning",
      {
        correlationId,
        method: "POST",
        route: "/api/admin/auth/callback/credentials",
        additional: { classification },
      },
    );
  } catch {
    // Reporting and reporter resolution are always best-effort.
  }
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
        const parsed = loginCredentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const correlationId = createCorrelationId();
        const reportFailure = (classification: LoginFailureClassification) =>
          reportAuthenticationFailure(correlationId, classification);

        let authServices;
        try {
          authServices = getAuthServices();
        } catch (error) {
          if (error instanceof AuthRateLimiterConfigurationError) {
            await reportFailure("rate_limiter_unavailable");
            throw new AuthenticationUnavailable();
          }
          await reportFailure("unexpected_internal");
          throw new AuthenticationInternalFailure();
        }

        let ip: string | null;
        try {
          ip = getClientIp(request.headers);
        } catch {
          await reportFailure("unexpected_internal");
          throw new AuthenticationInternalFailure();
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
          // performLogin already reported the PII-free internal classification.
          throw new AuthenticationInternalFailure();
        }

        if (outcome.status === "rate_limited") {
          // Lockout / fail-closed: distinguishable code, no account disclosure.
          throw new RateLimitedSignin();
        }
        if (outcome.status === "rate_limiter_unavailable") {
          throw new AuthenticationUnavailable();
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
