export interface ErrorReportContext {
  correlationId: string;
  method: string;
  route: string;
  actorId?: string;
}

export interface ErrorReporter {
  captureException(
    error: unknown,
    context: ErrorReportContext,
  ): void | Promise<void>;
}

export const noopErrorReporter: ErrorReporter = Object.freeze({
  captureException(): undefined {
    return undefined;
  },
});
