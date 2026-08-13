import { describe, expect, it } from "vitest";

import {
  isDiagnosticCode,
  isDiagnosticSeverity,
  isDiagnosticStage,
  safeStatusForCode,
  serializeDiagnosticEvent,
  type SafeDiagnosticEvent,
} from "@/server/diagnostics/events";

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

describe("serializeDiagnosticEvent", () => {
  it("emits a single-line JSON object with the tagged, allow-listed fields", () => {
    const line = serializeDiagnosticEvent(event());
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      evt: "diagnostic",
      correlationId: CORRELATION_ID,
      code: "RATE_LIMIT_PROVIDER_UNAUTHORIZED",
      stage: "auth.rate_limit.ip",
      severity: "error",
      route: "/api/admin/auth/callback/credentials",
      method: "POST",
      integration: "rate_limiter",
      safeStatus: 401,
      timestamp: "2026-08-14T00:00:00.000Z",
    });
  });

  it("omits optional fields that are absent or invalid", () => {
    const line = serializeDiagnosticEvent(
      event({
        route: undefined,
        method: undefined,
        integration: undefined,
        safeStatus: undefined,
      }),
    );
    const parsed = JSON.parse(line);
    expect(parsed).not.toHaveProperty("route");
    expect(parsed).not.toHaveProperty("integration");
    expect(parsed).not.toHaveProperty("safeStatus");
  });

  it("drops any stray field injected onto the event object", () => {
    const tainted = {
      ...event(),
      email: "owner@example.com",
      token: "SECRET",
      key: "auth:login:email:abc",
    } as unknown as SafeDiagnosticEvent;
    const line = serializeDiagnosticEvent(tainted);
    expect(line).not.toContain("owner@example.com");
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("auth:login:email");
    expect(JSON.parse(line)).not.toHaveProperty("email");
  });
});

describe("code/stage/severity guards and safe status", () => {
  it("recognizes valid vocabulary and rejects everything else", () => {
    expect(isDiagnosticCode("RATE_LIMIT_PROVIDER_TIMEOUT")).toBe(true);
    expect(isDiagnosticCode("NOT_A_CODE")).toBe(false);
    expect(isDiagnosticStage("auth.verify")).toBe(true);
    expect(isDiagnosticStage("auth.unknown")).toBe(false);
    expect(isDiagnosticSeverity("warning")).toBe(true);
    expect(isDiagnosticSeverity("fatal")).toBe(false);
  });

  it("derives coarse safe statuses only from stable codes", () => {
    expect(safeStatusForCode("RATE_LIMIT_PROVIDER_UNAUTHORIZED")).toBe(401);
    expect(safeStatusForCode("RATE_LIMIT_PROVIDER_FORBIDDEN")).toBe(403);
    expect(safeStatusForCode("RATE_LIMIT_PROVIDER_TIMEOUT")).toBe(408);
    expect(safeStatusForCode("RATE_LIMIT_PROVIDER_UNREACHABLE")).toBe(503);
    expect(safeStatusForCode("RATE_LIMIT_EXCEEDED")).toBeUndefined();
  });
});
