import "server-only";

import { headers } from "next/headers";

import { env } from "@/lib/env";
import { AppError } from "@/server/http/errors";

/**
 * Origin validation for custom non-GET server actions (defense in depth on top
 * of Next.js's built-in Server Action origin protection).
 *
 * When an `Origin` header is present it must match the configured application
 * origin, otherwise a 403 {@link AppError} is thrown. A missing `Origin` header
 * is left to Next.js's own same-origin enforcement rather than being rejected,
 * which would break legitimate same-origin form posts that omit it.
 */
function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function invalidOrigin(): AppError {
  return new AppError({
    status: 403,
    code: "INVALID_ORIGIN",
    message: "Request origin is not allowed",
  });
}

export async function assertSameOrigin(): Promise<void> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin === null) return;

  const expected = env.APP_ORIGIN;
  if (expected === undefined) throw invalidOrigin();

  const suppliedOrigin = originOf(origin);
  const expectedOrigin = originOf(expected);
  if (
    suppliedOrigin === null ||
    expectedOrigin === null ||
    suppliedOrigin !== expectedOrigin
  ) {
    throw invalidOrigin();
  }
}
