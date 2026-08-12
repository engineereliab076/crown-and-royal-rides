import NextAuth from "next-auth";

import { authEdgeConfig } from "@/server/auth/edge-config";

/**
 * Admin access middleware.
 *
 * Its ONLY job is a coarse, edge-safe gate: confirm the Auth.js session cookie
 * exists and is cryptographically valid (Auth.js decodes/verifies the JWT with
 * AUTH_SECRET), then allow, redirect anonymous page requests to the login page,
 * or return 401 for anonymous admin API requests. The decision logic lives in
 * `authEdgeConfig.callbacks.authorized`.
 *
 * It deliberately does NOT import Prisma, the auth repository/service, or
 * Argon2, does not touch the database, does not read session/active status, and
 * enforces no role or business rules — all of that is authoritative in Node
 * (session callback, layout, auth guard, and services).
 */
export const { auth: middleware } = NextAuth(authEdgeConfig);

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
