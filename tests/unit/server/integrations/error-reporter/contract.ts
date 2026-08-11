import { describe, expect, it } from "vitest";

import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type { ErrorReportContext } from "@/server/integrations/error-reporter/types";

const context: ErrorReportContext = {
  correlationId: "550e8400-e29b-41d4-a716-446655440000",
  route: "/api/fake",
  method: "POST",
};

export function runErrorReporterContract(
  name: string,
  createReporter: () => ErrorReporter,
): void {
  describe(`${name} ErrorReporter contract`, () => {
    it("accepts an unknown exception value", async () => {
      await expect(
        Promise.resolve(
          createReporter().captureException("fake failure", context),
        ),
      ).resolves.toBeUndefined();
    });

    it.each(["debug", "info", "warning", "error", "fatal"] as const)(
      "accepts the %s message level",
      async (level) => {
        await expect(
          Promise.resolve(
            createReporter().captureMessage("Fake event", level, context),
          ),
        ).resolves.toBeUndefined();
      },
    );
  });
}
