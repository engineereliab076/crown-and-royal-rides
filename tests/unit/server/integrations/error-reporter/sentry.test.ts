import { describe, expect, it, vi } from "vitest";

import {
  SentryErrorReporter,
  type SentryFacade,
  type SentryScopeFacade,
} from "@/server/integrations/error-reporter/sentry";
import type { ErrorReportValue } from "@/server/integrations/error-reporter/types";
import { runErrorReporterContract } from "./contract";

interface RecordedScope {
  readonly tags: Record<string, string>;
  readonly contexts: Record<string, Record<string, unknown> | null>;
}

function createFacade() {
  const scopes: RecordedScope[] = [];
  const captureException = vi.fn<SentryFacade["captureException"]>();
  const captureMessage = vi.fn<SentryFacade["captureMessage"]>();
  const facade: SentryFacade = {
    withIsolationScope(callback) {
      const record: RecordedScope = { tags: {}, contexts: {} };
      const scope: SentryScopeFacade = {
        setTag(key, value) {
          record.tags[key] = value;
        },
        setContext(name, context) {
          record.contexts[name] = context;
        },
      };
      scopes.push(record);
      callback(scope);
    },
    captureException,
    captureMessage,
  };
  return { facade, scopes, captureException, captureMessage };
}

function createReporter(
  client: SentryFacade = createFacade().facade,
  includeActorId = false,
) {
  return new SentryErrorReporter(
    {
      dsn: "https://public-key@sentry.example.test/1",
      environment: "development",
      enabled: true,
      includeActorId,
    },
    client,
  );
}

runErrorReporterContract("SentryErrorReporter", () => createReporter());

describe("SentryErrorReporter provider mapping", () => {
  it("preserves exception identity and isolates sanitized request context", () => {
    const client = createFacade();
    const reporter = createReporter(client.facade);
    const thrown = new Error("private fake failure");

    reporter.captureException(thrown, {
      correlationId: "correlation-123",
      actorId: "actor-not-approved",
      route: "/api/vehicles?token=must-not-appear",
      method: "post",
      additional: { feature: "vehicle-create", attempt: 2 },
    });

    expect(client.captureException).toHaveBeenCalledWith(thrown);
    expect(client.scopes).toEqual([
      {
        tags: { correlationId: "correlation-123" },
        contexts: {
          request: { route: "/api/vehicles", method: "POST" },
          additional: { feature: "vehicle-create", attempt: 2 },
        },
      },
    ]);
    expect(JSON.stringify(client.scopes)).not.toContain("must-not-appear");
    expect(JSON.stringify(client.scopes)).not.toContain("actor-not-approved");
  });

  it("attaches actorId only when explicitly approved", () => {
    const client = createFacade();
    createReporter(client.facade, true).captureMessage("Safe event", "info", {
      correlationId: "correlation-123",
      actorId: "actor-approved",
    });
    expect(client.scopes[0]?.tags).toEqual({
      correlationId: "correlation-123",
      actorId: "actor-approved",
    });
    expect(client.captureMessage).toHaveBeenCalledWith("Safe event", {
      level: "info",
    });
  });

  it.each<Readonly<Record<string, ErrorReportValue>>>([
    { inquiryText: "private" },
    { nested: { emailAddress: "private@example.test" } },
    { body: "private" },
  ])("rejects unsafe additional context %#", (additional) => {
    expect(() =>
      createReporter().captureException("fake", {
        correlationId: "correlation-123",
        additional,
      }),
    ).toThrow("Error-report context contains unsafe personal data.");
  });

  it("swallows thrown Sentry capture failures", () => {
    const client = createFacade();
    client.captureException.mockImplementation(() => {
      throw new Error("raw sentry failure");
    });
    expect(() =>
      createReporter(client.facade).captureException("fake", {
        correlationId: "correlation-123",
      }),
    ).not.toThrow();
  });

  it("does not call Sentry when disabled but still validates input", () => {
    const client = createFacade();
    const reporter = new SentryErrorReporter(
      {
        dsn: "https://public-key@sentry.example.test/1",
        environment: "development",
        enabled: false,
      },
      client.facade,
    );
    reporter.captureException("fake", { correlationId: "correlation-123" });
    expect(client.captureException).not.toHaveBeenCalled();
    expect(() =>
      reporter.captureMessage(" ", "info", {
        correlationId: "correlation-123",
      }),
    ).toThrow(TypeError);
  });
});
