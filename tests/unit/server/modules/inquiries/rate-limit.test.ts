import { describe, expect, it, vi } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import {
  enforcePurchaseInquiryRateLimit,
  PURCHASE_INQUIRY_IP_POLICY,
  PURCHASE_INQUIRY_PHONE_POLICY,
} from "@/server/modules/inquiries/rate-limit";

const SECRET = "a-safe-test-secret-that-is-at-least-32-characters";

describe("purchase inquiry rate limit", () => {
  it("consumes protected IP and phone checks without raw identifiers", async () => {
    const check = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: Date.now() + 1000,
    });
    await enforcePurchaseInquiryRateLimit({
      rateLimiter: { check },
      errorReporter: new InMemoryErrorReporter(),
      hashSecret: SECRET,
      correlationId: "correlation",
      clientIp: "203.0.113.9",
      normalizedPhone: "+255712345678",
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[0]?.[1]).toEqual(PURCHASE_INQUIRY_IP_POLICY);
    expect(check.mock.calls[1]?.[1]).toEqual(PURCHASE_INQUIRY_PHONE_POLICY);
    const keys = check.mock.calls.map(([key]) => String(key)).join(" ");
    expect(keys).not.toContain("203.0.113.9");
    expect(keys).not.toContain("255712345678");
  });

  it("distinguishes genuine exhaustion as 429", async () => {
    const limiter: RateLimiter = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: Date.now() + 9000,
        retryAfterMs: 9000,
      }),
    };
    await expect(
      enforcePurchaseInquiryRateLimit({
        rateLimiter: limiter,
        errorReporter: new InMemoryErrorReporter(),
        hashSecret: SECRET,
        correlationId: "correlation",
        clientIp: null,
        normalizedPhone: "+255712345678",
      }),
    ).rejects.toMatchObject({ status: 429, code: "INQUIRY_RATE_LIMITED" });
  });

  it("fails closed as 503 and reports only safe dimensions", async () => {
    const reporter = new InMemoryErrorReporter();
    await expect(
      enforcePurchaseInquiryRateLimit({
        rateLimiter: { check: vi.fn().mockRejectedValue(new Error("secret")) },
        errorReporter: reporter,
        hashSecret: SECRET,
        correlationId: "correlation",
        clientIp: "203.0.113.9",
        normalizedPhone: "+255712345678",
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "INQUIRY_RATE_LIMIT_UNAVAILABLE",
    });
    const reports = JSON.stringify(reporter.getReports());
    expect(reports).not.toContain("203.0.113.9");
    expect(reports).not.toContain("255712345678");
    expect(reports).not.toContain("secret");
  });
});
