import { copyErrorReportContext } from "@/server/integrations/error-reporter/context";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type {
  ErrorReportContext,
  ErrorReportLevel,
} from "@/server/integrations/error-reporter/types";

export type CapturedErrorReport =
  | Readonly<{
      type: "exception";
      error: unknown;
      context: ErrorReportContext;
    }>
  | Readonly<{
      type: "message";
      message: string;
      level: ErrorReportLevel;
      context: ErrorReportContext;
    }>;

const LEVELS: readonly ErrorReportLevel[] = [
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
];

function copyReport(report: CapturedErrorReport): CapturedErrorReport {
  if (report.type === "exception") {
    return Object.freeze({
      type: report.type,
      error: report.error,
      context: copyErrorReportContext(report.context),
    });
  }

  return Object.freeze({
    type: report.type,
    message: report.message,
    level: report.level,
    context: copyErrorReportContext(report.context),
  });
}

export class InMemoryErrorReporter implements ErrorReporter {
  readonly #reports: CapturedErrorReport[] = [];
  #hasNextFailure = false;
  #nextFailure: unknown;

  captureException(error: unknown, context: ErrorReportContext): void {
    this.#throwConfiguredFailure();
    this.#reports.push(
      Object.freeze({
        type: "exception",
        error,
        context: copyErrorReportContext(context),
      }),
    );
  }

  captureMessage(
    message: string,
    level: ErrorReportLevel,
    context: ErrorReportContext,
  ): void {
    this.#throwConfiguredFailure();
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("Reported message must be a non-empty string.");
    }
    if (!LEVELS.includes(level)) {
      throw new TypeError("Reported message level is invalid.");
    }

    this.#reports.push(
      Object.freeze({
        type: "message",
        message: message.trim(),
        level,
        context: copyErrorReportContext(context),
      }),
    );
  }

  failNext(error: unknown): void {
    this.#hasNextFailure = true;
    this.#nextFailure = error;
  }

  getReports(): ReadonlyArray<CapturedErrorReport> {
    return Object.freeze(this.#reports.map(copyReport));
  }

  reset(): void {
    this.#reports.length = 0;
    this.#hasNextFailure = false;
    this.#nextFailure = undefined;
  }

  #throwConfiguredFailure(): void {
    if (!this.#hasNextFailure) return;

    const failure = this.#nextFailure;
    this.#hasNextFailure = false;
    this.#nextFailure = undefined;
    throw failure;
  }
}
