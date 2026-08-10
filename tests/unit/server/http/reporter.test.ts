import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { noopErrorReporter } from "@/server/http/reporter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("noopErrorReporter", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(noopErrorReporter)).toBe(true);
  });

  it("accepts an error and representative context without throwing", () => {
    expect(() =>
      noopErrorReporter.captureException(new Error("example"), {
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        method: "POST",
        route: "/api/example",
        actorId: "actor-123",
      }),
    ).not.toThrow();
  });

  it("returns undefined", () => {
    expect(
      noopErrorReporter.captureException("failure", {
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        method: "GET",
        route: "/health",
      }),
    ).toBeUndefined();
  });

  it("does not write to the console", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    noopErrorReporter.captureException(new Error("private"), {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      method: "PATCH",
      route: "/api/resource",
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("contains no Sentry or provider import", () => {
    const sourcePath = fileURLToPath(
      new URL("../../../../src/server/http/reporter.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/from\s+["']@sentry\//);
    expect(source).not.toMatch(/from\s+["'](?:cloudinary|resend|@upstash)\b/);
    expect(source).not.toContain("process.env");
  });
});
