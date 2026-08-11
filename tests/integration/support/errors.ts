import { Prisma } from "@/generated/prisma/client";

/**
 * Helpers for asserting database errors by stable properties (Prisma error code,
 * constraint name) rather than brittle full-message matching.
 */

export function isKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

/** The Prisma error code (e.g. "P2002") if this is a known request error. */
export function prismaErrorCode(error: unknown): string | undefined {
  return isKnownRequestError(error) ? error.code : undefined;
}

/**
 * A searchable description combining the message and structured metadata. Used
 * to assert that a specific constraint name is present, which for the pg driver
 * adapter is carried in the message and/or `meta`.
 */
export function describeDatabaseError(error: unknown): string {
  if (isKnownRequestError(error)) {
    const meta = error.meta === undefined ? "" : JSON.stringify(error.meta);
    return `${error.code} ${error.message} ${meta}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract the underlying PostgreSQL SQLSTATE (e.g. "23502" for a not-null
 * violation) from a Prisma error. Raw-query failures surface as `P2010` whose
 * `meta` carries the driver's `code`; as a fallback the code is matched from the
 * error text. Returns `undefined` when no SQLSTATE can be found.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  if (isKnownRequestError(error) && error.meta !== null) {
    const meta: unknown = error.meta;
    if (typeof meta === "object" && meta !== undefined) {
      const code = (meta as Record<string, unknown>).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        return code;
      }
    }
  }
  const match = describeDatabaseError(error).match(/\b([0-9]{2}[0-9A-Z]{3})\b/);
  return match?.[1];
}
