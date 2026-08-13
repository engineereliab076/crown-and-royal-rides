import { describe, expect, it } from "vitest";

import {
  AUTH_CALLBACK_METHOD,
  AUTH_CALLBACK_ROUTE,
  buildLoginDiagnosticEvent,
} from "@/server/diagnostics/auth-events";
import type { LoginDiagnostic } from "@/server/auth/login";

const CORRELATION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const fixedNow = () => new Date("2026-08-14T12:00:00.000Z");

describe("buildLoginDiagnosticEvent", () => {
  it("propagates the exact correlation ID and the safe request context", () => {
    const diagnostic: LoginDiagnostic = {
      stage: "auth.rate_limit.ip",
      code: "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
      severity: "error",
    };
    const event = buildLoginDiagnosticEvent(
      CORRELATION_ID,
      diagnostic,
      fixedNow,
    );

    expect(event.correlationId).toBe(CORRELATION_ID);
    expect(event.code).toBe("RATE_LIMIT_PROVIDER_UNAUTHORIZED");
    expect(event.stage).toBe("auth.rate_limit.ip");
    expect(event.route).toBe(AUTH_CALLBACK_ROUTE);
    expect(event.method).toBe(AUTH_CALLBACK_METHOD);
    expect(event.integration).toBe("rate_limiter");
    expect(event.safeStatus).toBe(401);
    expect(event.timestamp).toBe("2026-08-14T12:00:00.000Z");
  });

  it("tags the rate-limiter integration only for rate-limit stages", () => {
    const event = buildLoginDiagnosticEvent(
      CORRELATION_ID,
      {
        stage: "auth.verify",
        code: "AUTH_UNEXPECTED_INTERNAL",
        severity: "error",
      },
      fixedNow,
    );
    expect(event.integration).toBeUndefined();
    expect(event.safeStatus).toBeUndefined();
  });

  it("carries the missing configuration variable names for a services gap", () => {
    const event = buildLoginDiagnosticEvent(
      CORRELATION_ID,
      {
        stage: "auth.services",
        code: "RATE_LIMIT_CONFIGURATION_MISSING",
        severity: "error",
        missing: ["IP_HASH_SECRET"],
      },
      fixedNow,
    );
    expect(event.missing).toEqual(["IP_HASH_SECRET"]);
    expect(event.integration).toBeUndefined();
  });

  it("never carries anything beyond the allow-listed fields", () => {
    const event = buildLoginDiagnosticEvent(
      CORRELATION_ID,
      {
        stage: "auth.bookkeeping",
        code: "AUTH_BOOKKEEPING_DEGRADED",
        severity: "warning",
      },
      fixedNow,
    );
    expect(Object.keys(event).sort()).toEqual(
      [
        "code",
        "correlationId",
        "method",
        "route",
        "severity",
        "stage",
        "timestamp",
      ].sort(),
    );
  });
});
