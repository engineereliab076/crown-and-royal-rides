export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ErrorDetails = Readonly<Record<string, JsonValue>>;

export interface AppErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetails;
  headers?: Readonly<Record<string, string>>;
  cause?: unknown;
}

const APP_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const HEADER_LINE_BREAK_PATTERN = /[\r\n]/;

function copyAndValidateHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const copy: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (
      name.trim().length === 0 ||
      typeof value !== "string" ||
      HEADER_LINE_BREAK_PATTERN.test(name) ||
      HEADER_LINE_BREAK_PATTERN.test(value)
    ) {
      throw new TypeError("AppError headers must be safe HTTP header values.");
    }

    copy[name] = value;
  }

  return Object.freeze(copy);
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails;
  readonly headers: Readonly<Record<string, string>>;

  constructor(options: AppErrorOptions) {
    if (
      !Number.isSafeInteger(options.status) ||
      options.status < 400 ||
      options.status > 599
    ) {
      throw new TypeError(
        "AppError status must be an integer from 400 through 599.",
      );
    }

    if (
      typeof options.code !== "string" ||
      !APP_ERROR_CODE_PATTERN.test(options.code)
    ) {
      throw new TypeError(
        "AppError code must use uppercase letters, digits, and underscores.",
      );
    }

    if (
      typeof options.message !== "string" ||
      options.message.trim().length === 0
    ) {
      throw new TypeError("AppError message must be a non-empty string.");
    }

    const message = options.message.trim();
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = "AppError";
    this.status = options.status;
    this.code = options.code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.headers = copyAndValidateHeaders(options.headers);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
