import type {
  ErrorReportContext,
  ErrorReportLevel,
} from "@/server/integrations/error-reporter/types";

export interface ErrorReporter {
  captureException(
    error: unknown,
    context: ErrorReportContext,
  ): void | Promise<void>;

  captureMessage(
    message: string,
    level: ErrorReportLevel,
    context: ErrorReportContext,
  ): void | Promise<void>;
}
