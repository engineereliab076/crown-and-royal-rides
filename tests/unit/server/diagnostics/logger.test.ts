import { describe, expect, it, vi } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import {
  emitDiagnosticEvent,
  type DiagnosticSink,
} from "@/server/diagnostics/logger";
import type { SafeDiagnosticEvent } from "@/server/diagnostics/events";

const CORRELATION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function event(
  overrides: Partial<SafeDiagnosticEvent> = {},
): SafeDiagnosticEvent {
  return {
    correlationId: CORRELATION_ID,
    code: "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
    stage: "auth.rate_limit.ip",
    severity: "error",
    route: "/api/admin/auth/callback/credentials",
    method: "POST",
    integration: "rate_limiter",
    safeStatus: 401,
    timestamp: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function captureSink(): { sink: DiagnosticSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { info: (line) => lines.push(line) }, lines };
}

describe("emitDiagnosticEvent", () => {
  it("writes exactly one structured line and nothing more", () => {
    const { sink, lines } = captureSink();
    emitDiagnosticEvent(event(), { sink });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      evt: "diagnostic",
      correlationId: CORRELATION_ID,
      code: "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
    });
  });

  it("forwards the stable code to the reporter as a separate, safe channel", () => {
    const { sink } = captureSink();
    const reporter = new InMemoryErrorReporter();
    emitDiagnosticEvent(event(), { sink, reporter });

    const reports = reporter.getReports();
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report?.type).toBe("message");
    if (report?.type === "message") {
      expect(report.message).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
      expect(report.level).toBe("error");
      expect(report.context.correlationId).toBe(CORRELATION_ID);
      expect(report.context.additional).toEqual({
        stage: "auth.rate_limit.ip",
        integration: "rate_limiter",
        safeStatus: 401,
      });
    }
  });

  it("forwards missing-config names to both the line and the reporter", () => {
    const { sink, lines } = captureSink();
    const reporter = new InMemoryErrorReporter();
    emitDiagnosticEvent(
      event({
        code: "RATE_LIMIT_CONFIGURATION_MISSING",
        stage: "auth.services",
        integration: undefined,
        safeStatus: undefined,
        missing: ["IP_HASH_SECRET"],
      }),
      { sink, reporter },
    );

    expect(JSON.parse(lines[0] as string).missing).toEqual(["IP_HASH_SECRET"]);
    const report = reporter.getReports()[0];
    if (report?.type === "message") {
      expect(report.context.additional).toMatchObject({
        missing: ["IP_HASH_SECRET"],
      });
    }
  });

  it("never emits an event that fails validation", () => {
    const { sink, lines } = captureSink();
    emitDiagnosticEvent(
      event({ code: "NOPE" as SafeDiagnosticEvent["code"] }),
      { sink },
    );
    emitDiagnosticEvent(event({ correlationId: "not-a-uuid" }), { sink });
    expect(lines).toHaveLength(0);
  });

  it("never throws when the sink fails", () => {
    const throwingSink: DiagnosticSink = {
      info: () => {
        throw new Error("sink down");
      },
    };
    expect(() =>
      emitDiagnosticEvent(event(), { sink: throwingSink }),
    ).not.toThrow();
  });

  it("still logs the line when the reporter throws", () => {
    const { sink, lines } = captureSink();
    const reporter = new InMemoryErrorReporter();
    reporter.failNext(new Error("sentry down"));
    expect(() =>
      emitDiagnosticEvent(event(), { sink, reporter }),
    ).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it("does not emit duplicate lines for one call", () => {
    const info = vi.fn();
    emitDiagnosticEvent(event(), { sink: { info } });
    expect(info).toHaveBeenCalledTimes(1);
  });
});
