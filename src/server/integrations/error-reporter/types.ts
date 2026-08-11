export type ErrorReportLevel = "debug" | "info" | "warning" | "error" | "fatal";

export type ErrorReportPrimitive = string | number | boolean | null;
export type ErrorReportValue =
  | ErrorReportPrimitive
  | readonly ErrorReportValue[]
  | Readonly<{ [key: string]: ErrorReportValue }>;

export interface ErrorReportContext {
  readonly correlationId: string;
  readonly actorId?: string;
  readonly route?: string;
  readonly method?: string;
  /** Safe, deliberately selected metadata only; never request or secret data. */
  readonly additional?: Readonly<Record<string, ErrorReportValue>>;
}
