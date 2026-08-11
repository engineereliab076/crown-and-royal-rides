import { describe, expect, it } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import type { ErrorReportContext } from "@/server/integrations/error-reporter/types";
import { runErrorReporterContract } from "./contract";

runErrorReporterContract(
  "InMemoryErrorReporter",
  () => new InMemoryErrorReporter(),
);

function fakeContext(): ErrorReportContext {
  return {
    correlationId: "550e8400-e29b-41d4-a716-446655440000",
    actorId: "actor-123",
    route: "/api/vehicles",
    method: "POST",
    additional: {
      feature: "vehicle-create",
      attempt: 2,
      flags: ["fake", { retryable: true }],
    },
  };
}

describe("InMemoryErrorReporter inspection behavior", () => {
  it("records exceptions in order and preserves exact identity", () => {
    const reporter = new InMemoryErrorReporter();
    const thrown = new Error("private fake failure");

    reporter.captureException(thrown, fakeContext());
    reporter.captureException("second fake failure", fakeContext());

    const reports = reporter.getReports();
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ type: "exception" });
    if (reports[0]?.type === "exception") {
      expect(reports[0].error).toBe(thrown);
    }
    if (reports[1]?.type === "exception") {
      expect(reports[1].error).toBe("second fake failure");
    }
  });

  it("records message level and copied context", () => {
    const reporter = new InMemoryErrorReporter();
    reporter.captureMessage("Fake warning", "warning", fakeContext());

    expect(reporter.getReports()).toEqual([
      {
        type: "message",
        message: "Fake warning",
        level: "warning",
        context: fakeContext(),
      },
    ]);
  });

  it("caller mutation cannot alter stored nested context", () => {
    const reporter = new InMemoryErrorReporter();
    const flags: Array<string | { retryable: boolean }> = [
      "fake",
      { retryable: true },
    ];
    const context: ErrorReportContext = {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      additional: { flags },
    };

    reporter.captureException("fake", context);
    flags[0] = "changed";
    const nested = flags[1];
    if (typeof nested === "object") nested.retryable = false;

    expect(reporter.getReports()[0]?.context.additional).toEqual({
      flags: ["fake", { retryable: true }],
    });
  });

  it("history and all copied context layers are frozen", () => {
    const reporter = new InMemoryErrorReporter();
    reporter.captureException("fake", fakeContext());

    const reports = reporter.getReports();
    const additional = reports[0]?.context.additional;
    const flags = additional?.flags;
    expect(Object.isFrozen(reports)).toBe(true);
    expect(Object.isFrozen(reports[0])).toBe(true);
    expect(Object.isFrozen(reports[0]?.context)).toBe(true);
    expect(Object.isFrozen(additional)).toBe(true);
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it("rejects secret-like additional-context keys", () => {
    const reporter = new InMemoryErrorReporter();
    expect(() =>
      reporter.captureException("fake", {
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        additional: { authorizationHeader: "not-a-real-value" },
      }),
    ).toThrow("Error-report context contains an unsafe key.");
  });

  it("a configured failure affects one capture only", () => {
    const reporter = new InMemoryErrorReporter();
    const failure = new Error("fake reporter outage");
    reporter.failNext(failure);

    expect(() => reporter.captureException("first", fakeContext())).toThrow(
      failure,
    );
    expect(() =>
      reporter.captureException("second", fakeContext()),
    ).not.toThrow();
    expect(reporter.getReports()).toHaveLength(1);
  });

  it("reset clears reports and configured failure", () => {
    const reporter = new InMemoryErrorReporter();
    reporter.captureException("fake", fakeContext());
    reporter.failNext(new Error("unused fake failure"));

    reporter.reset();

    expect(reporter.getReports()).toEqual([]);
    expect(() =>
      reporter.captureMessage("After reset", "info", fakeContext()),
    ).not.toThrow();
  });
});
