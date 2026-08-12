import type { AdminRole } from "@/generated/prisma/enums";
import type { DefaultSession } from "next-auth";

/**
 * Auth.js type augmentation.
 *
 * Only non-sensitive administrator identity fields are carried in the JWT and
 * session. Password hashes, active status, and any database objects are
 * deliberately excluded — active status and the authoritative role are resolved
 * from the database inside the session callback on every session retrieval.
 */

declare module "next-auth" {
  /** The object returned from the Credentials `authorize` callback. */
  interface User {
    role: AdminRole;
    sessionVersion: number;
    mustChangePassword: boolean;
  }

  interface Session {
    // `user` is optional: the session callback clears it when database
    // validation fails, so an invalid session exposes no authenticated user.
    user?: {
      id: string;
      name: string;
      role: AdminRole;
      sessionVersion: number;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
    role: AdminRole;
    sessionVersion: number;
    mustChangePassword: boolean;
  }
}
