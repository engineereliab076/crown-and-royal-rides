import { createCorrelationId } from "@/lib/correlation";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import { noopErrorReporter } from "@/server/integrations/error-reporter/noop";
import { AppError, isAppError, type ErrorDetails } from "@/server/http/errors";

export interface RouteExecutionContext {
  correlationId: string;
}

export type RouteHandler<TContext> = (
  request: Request,
  context: TContext,
  execution: RouteExecutionContext,
) => Response | Promise<Response>;

export interface WrappedRouteHandler<TContext> {
  (request: Request, context: TContext): Promise<Response>;
}

export type OriginPolicy =
  | {
      mode: "required";
      allowedOrigin: string;
    }
  | {
      mode: "exempt";
    };

export interface RouteHandlerOptions {
  origin: OriginPolicy;
  errorReporter?: ErrorReporter;
}

interface NormalizedRequiredOriginPolicy {
  mode: "required";
  allowedOrigin: string;
}

interface NormalizedExemptOriginPolicy {
  mode: "exempt";
}

type NormalizedOriginPolicy =
  NormalizedRequiredOriginPolicy | NormalizedExemptOriginPolicy;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CORRELATION_HEADER = "X-Correlation-ID";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function parseHttpOrigin(value: string): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return null;
  }

  return url.origin;
}

function normalizeOriginPolicy(policy: OriginPolicy): NormalizedOriginPolicy {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new TypeError("A valid explicit origin policy is required.");
  }

  if (policy.mode === "required") {
    const allowedOrigin = parseHttpOrigin(policy.allowedOrigin);

    if (allowedOrigin === null) {
      throw new TypeError(
        "allowedOrigin must be an absolute HTTP or HTTPS origin.",
      );
    }

    return { mode: "required", allowedOrigin };
  }

  if (policy.mode === "exempt") {
    if ("allowedOrigin" in policy) {
      throw new TypeError(
        "An exempt origin policy cannot contain allowedOrigin.",
      );
    }

    return { mode: "exempt" };
  }

  throw new TypeError("A valid explicit origin policy is required.");
}

function assertRequestOrigin(
  request: Request,
  method: string,
  policy: NormalizedOriginPolicy,
): void {
  if (policy.mode === "exempt" || SAFE_METHODS.has(method)) {
    return;
  }

  const suppliedOrigin = request.headers.get("Origin");
  const normalizedOrigin =
    suppliedOrigin === null ? null : parseHttpOrigin(suppliedOrigin);

  if (normalizedOrigin !== policy.allowedOrigin) {
    throw new AppError({
      status: 403,
      code: "INVALID_ORIGIN",
      message: "Request origin is not allowed",
    });
  }
}

function addCorrelationHeader(
  response: Response,
  correlationId: string,
): Response {
  try {
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(CORRELATION_HEADER, correlationId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

function createErrorResponse(
  status: number,
  code: string,
  message: string,
  details: ErrorDetails,
  correlationId: string,
  suppliedHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = new Headers(suppliedHeaders);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set(CORRELATION_HEADER, correlationId);

  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        details,
        correlationId,
      },
    }),
    { status, headers },
  );
}

function getRoute(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "<unknown>";
  }
}

async function reportUnexpectedError(
  reporter: ErrorReporter,
  error: unknown,
  correlationId: string,
  method: string,
  request: Request,
): Promise<void> {
  try {
    await reporter.captureException(error, {
      correlationId,
      method,
      route: getRoute(request),
    });
  } catch {
    // Reporting must never interfere with the application response.
  }
}

export function withRouteHandler<TContext>(
  handler: RouteHandler<TContext>,
  options: RouteHandlerOptions,
): WrappedRouteHandler<TContext> {
  const originPolicy = normalizeOriginPolicy(options.origin);
  const errorReporter = options.errorReporter ?? noopErrorReporter;

  return async (request: Request, context: TContext): Promise<Response> => {
    const correlationId = createCorrelationId();
    const method = request.method.toUpperCase();

    try {
      assertRequestOrigin(request, method, originPolicy);

      const response = await handler(request, context, { correlationId });

      if (!(response instanceof Response)) {
        throw new TypeError("Route handler must return a Response.");
      }

      return addCorrelationHeader(response, correlationId);
    } catch (error) {
      if (isAppError(error)) {
        return createErrorResponse(
          error.status,
          error.code,
          error.message,
          error.details,
          correlationId,
          error.headers,
        );
      }

      await reportUnexpectedError(
        errorReporter,
        error,
        correlationId,
        method,
        request,
      );

      return createErrorResponse(
        500,
        "INTERNAL_SERVER_ERROR",
        "Something went wrong",
        {},
        correlationId,
      );
    }
  };
}
