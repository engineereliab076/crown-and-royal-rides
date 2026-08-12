import "server-only";

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getClientIp } from "@/server/http/client-ip";
import {
  applyUserToToken,
  buildValidatedSession,
} from "@/server/auth/callbacks";
import { authEdgeConfig } from "@/server/auth/edge-config";
import { performLogin } from "@/server/auth/login";
import { getAuthServices } from "@/server/auth/services";
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

/** Distinguishable, non-sensitive code so the login UI can show a lockout note. */
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
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
        const { authService, authRateLimiter } = getAuthServices();
        const ip = getClientIp(request.headers);

        // Ordering and counting live in performLogin: IP consumed before Argon2
        // (bounds all attempts, fail-closed), email failure allowance consumed
        // only on a failed verification (successes never spend it).
        const outcome = await performLogin(
          { email, password, ip },
          { authService, authRateLimiter },
        );

        if (outcome.status === "rate_limited") {
          // Lockout / fail-closed: distinguishable code, no account disclosure.
          throw new RateLimitedSignin();
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
