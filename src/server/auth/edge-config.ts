import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";

/**
 * Edge-safe Auth.js configuration.
 *
 * This module is imported by the middleware, so it must never pull in Prisma,
 * the auth repository/service, Argon2, or any provider SDK. It contains only
 * static configuration and the coarse `authorized` gate that decides, purely
 * from the presence of a cryptographically valid session token, whether a
 * request may proceed. All authoritative checks (active status, session
 * version, role, forced password change) happen later in Node — never here.
 */

/** Auth.js route base path required by Phase 2. */
export const AUTH_BASE_PATH = "/api/admin/auth";
/** Anonymous login page. */
export const LOGIN_PATH = "/admin/login";

export type AdminAccessDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect-login" }
  | { readonly kind: "unauthorized" };

/**
 * Decide access for an admin-scoped request from the pathname and whether a
 * valid session token is present. The Auth.js endpoints and the login page are
 * always allowed so authentication itself never gets blocked (no redirect
 * loops); anonymous API requests get a 401, anonymous page requests a redirect.
 */
export function evaluateAdminAccess(input: {
  pathname: string;
  isLoggedIn: boolean;
}): AdminAccessDecision {
  const { pathname, isLoggedIn } = input;

  if (pathname.startsWith(AUTH_BASE_PATH)) return { kind: "allow" };
  if (pathname === LOGIN_PATH) return { kind: "allow" };
  if (isLoggedIn) return { kind: "allow" };
  if (pathname.startsWith("/api/admin")) return { kind: "unauthorized" };
  return { kind: "redirect-login" };
}

export const authEdgeConfig = {
  basePath: AUTH_BASE_PATH,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: LOGIN_PATH },
  // No providers here: the Credentials provider (which imports Node-only code)
  // is added only in the full Node configuration, keeping the edge bundle clean.
  providers: [],
  callbacks: {
    authorized({ request, auth }) {
      const decision = evaluateAdminAccess({
        pathname: request.nextUrl.pathname,
        isLoggedIn: auth !== null,
      });

      if (decision.kind === "allow") return true;
      if (decision.kind === "unauthorized") {
        return NextResponse.json(
          {
            error: {
              code: "AUTH_REQUIRED",
              message: "Authentication required.",
            },
          },
          { status: 401 },
        );
      }
      // redirect-login: returning false makes Auth.js redirect to pages.signIn
      // with a safe, same-origin callbackUrl.
      return false;
    },
  },
} satisfies NextAuthConfig;
