import { describe, expect, it, vi } from "vitest";

import { noopErrorReporter } from "@/server/integrations/error-reporter/noop";
import { runErrorReporterContract } from "./contract";

runErrorReporterContract("NoopErrorReporter", () => noopErrorReporter);

describe("noopErrorReporter", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(noopErrorReporter)).toBe(true);
  });

  it("never throws for either capture operation", () => {
    const context = {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
    };

    expect(() =>
      noopErrorReporter.captureException(Symbol("fake"), context),
    ).not.toThrow();
    expect(() =>
      noopErrorReporter.captureMessage("Fake message", "info", context),
    ).not.toThrow();
  });

  it("never writes to the console", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
    };

    noopErrorReporter.captureException("fake", context);
    noopErrorReporter.captureMessage("Fake message", "warning", context);

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
