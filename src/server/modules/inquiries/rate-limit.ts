import "server-only";

import { createHmac } from "node:crypto";

import { AppError } from "@/server/http/errors";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import { rateLimitCodeFrom } from "@/server/integrations/rate-limiter/classify";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import type { RateLimitPolicy } from "@/server/integrations/rate-limiter/types";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const PURCHASE_INQUIRY_IP_POLICY: RateLimitPolicy = {
  limit: 10,
  windowMs: FIFTEEN_MINUTES_MS,
};

export const PURCHASE_INQUIRY_PHONE_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: FIFTEEN_MINUTES_MS,
};

function protectedKey(secret: string, scope: "ip" | "phone", value: string) {
  const digest = createHmac("sha256", secret).update(value).digest("base64url");
  return `inquiry:purchase:${scope}:${digest}`;
}

async function reportUnavailable(
  reporter: ErrorReporter,
  correlationId: string,
  dimension: "ip" | "phone",
  error: unknown,
): Promise<void> {
  try {
    await reporter.captureMessage(
      "Purchase inquiry rate limiter unavailable.",
      "error",
      {
        correlationId,
        additional: {
          operation: "purchase-inquiry-rate-limit",
          stage: dimension,
          code: rateLimitCodeFrom(error),
        },
      },
    );
  } catch {}
}

export async function enforcePurchaseInquiryRateLimit(input: {
  readonly rateLimiter: RateLimiter;
  readonly errorReporter: ErrorReporter;
  readonly hashSecret: string;
  readonly correlationId: string;
  readonly clientIp: string | null;
  readonly normalizedPhone: string;
}): Promise<void> {
  if (input.hashSecret.length < 32) {
    throw new AppError({
      status: 503,
      code: "INQUIRY_RATE_LIMIT_UNAVAILABLE",
      message: "Purchase requests are temporarily unavailable.",
    });
  }

  const checks = await Promise.allSettled([
    input.rateLimiter.check(
      protectedKey(input.hashSecret, "ip", input.clientIp ?? "unknown"),
      PURCHASE_INQUIRY_IP_POLICY,
    ),
    input.rateLimiter.check(
      protectedKey(input.hashSecret, "phone", input.normalizedPhone),
      PURCHASE_INQUIRY_PHONE_POLICY,
    ),
  ]);

  const dimensions = ["ip", "phone"] as const;
  let unavailable = false;
  for (const [index, result] of checks.entries()) {
    if (result.status === "rejected") {
      unavailable = true;
      await reportUnavailable(
        input.errorReporter,
        input.correlationId,
        dimensions[index] ?? "ip",
        result.reason,
      );
    }
  }
  if (unavailable) {
    throw new AppError({
      status: 503,
      code: "INQUIRY_RATE_LIMIT_UNAVAILABLE",
      message: "Purchase requests are temporarily unavailable.",
    });
  }

  const denied = checks
    .filter((result) => result.status === "fulfilled" && !result.value.allowed)
    .map((result) =>
      result.status === "fulfilled"
        ? (result.value.retryAfterMs ?? 1000)
        : 1000,
    );
  if (denied.length > 0) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Math.max(...denied) / 1000),
    );
    throw new AppError({
      status: 429,
      code: "INQUIRY_RATE_LIMITED",
      message: "Too many purchase requests. Please try again later.",
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }
}
