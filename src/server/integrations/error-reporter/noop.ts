import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type {
  ErrorReportContext,
  ErrorReportLevel,
} from "@/server/integrations/error-reporter/types";

export class NoopErrorReporter implements ErrorReporter {
  captureException(error: unknown, context: ErrorReportContext): undefined {
    void error;
    void context;
    return undefined;
  }

  captureMessage(
    message: string,
    level: ErrorReportLevel,
    context: ErrorReportContext,
  ): undefined {
    void message;
    void level;
    void context;
    return undefined;
  }
}

export const noopErrorReporter: ErrorReporter = Object.freeze(
  new NoopErrorReporter(),
);
