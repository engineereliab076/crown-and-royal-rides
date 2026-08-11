import type {
  ErrorReportContext,
  ErrorReportValue,
} from "@/server/integrations/error-reporter/types";

const SENSITIVE_CONTEXT_KEY =
  /password|authorization|cookie|database.?url|secret|token/i;

function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function copyValue(value: ErrorReportValue): ErrorReportValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Error-report context numbers must be finite.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map(copyValue));
  }

  if (typeof value === "object") {
    const copy: Record<string, ErrorReportValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key.trim().length === 0 || SENSITIVE_CONTEXT_KEY.test(key)) {
        throw new TypeError("Error-report context contains an unsafe key.");
      }
      copy[key] = copyValue(nested);
    }
    return Object.freeze(copy);
  }

  throw new TypeError("Error-report context contains an unsupported value.");
}

export function copyErrorReportContext(
  context: ErrorReportContext,
): ErrorReportContext {
  if (typeof context !== "object" || context === null) {
    throw new TypeError("Error-report context must be an object.");
  }

  const additional =
    context.additional === undefined
      ? undefined
      : (copyValue(context.additional) as Readonly<
          Record<string, ErrorReportValue>
        >);

  return Object.freeze({
    correlationId: nonEmpty(context.correlationId, "correlationId"),
    ...(context.actorId === undefined
      ? {}
      : { actorId: nonEmpty(context.actorId, "actorId") }),
    ...(context.route === undefined
      ? {}
      : { route: nonEmpty(context.route, "route") }),
    ...(context.method === undefined
      ? {}
      : { method: nonEmpty(context.method, "method") }),
    ...(additional === undefined ? {} : { additional }),
  });
}
