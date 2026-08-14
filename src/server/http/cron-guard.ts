import "server-only";

import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { AppError } from "@/server/http/errors";

/**
 * Server-to-server cron authorization.
 *
 * A cron invocation authenticates with `Authorization: Bearer <CRON_SECRET>` —
 * never an administrator cookie and never browser-origin validation. The
 * comparison is constant-time and neither the supplied header nor the configured
 * secret is ever logged or echoed. A missing or incorrect credential (or an
 * unconfigured secret) yields a stable 401.
 */

function cronUnauthorized(): AppError {
  return new AppError({
    status: 401,
    code: "CRON_UNAUTHORIZED",
    message: "Cron authorization required.",
  });
}

/** Constant-time string equality that does not short-circuit on length. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Compare a buffer against itself so a length mismatch costs the same as a
    // content mismatch, avoiding a length-based timing signal.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function requireCronAuthorization(request: Request): void {
  const secret = env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  if (typeof secret !== "string" || secret.length === 0) {
    throw cronUnauthorized();
  }
  if (!safeEqual(supplied, `Bearer ${secret}`)) {
    throw cronUnauthorized();
  }
}
