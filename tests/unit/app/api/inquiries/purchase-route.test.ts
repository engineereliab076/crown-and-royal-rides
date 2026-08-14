import { describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/lib/env.schema";
import { createIntegrationContainer } from "@/server/integrations/container";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type { InquiryService } from "@/server/modules/inquiries/service";

import { createPurchaseInquiryPost } from "@/server/modules/inquiries/purchase-route";

/**
 * A reporter thunk backed by a genuinely production-shaped integration container
 * with database/Cloudinary/Resend/Upstash configured but all Sentry variables
 * absent — the exact Vercel Production build shape. Invoking the thunk throws
 * the same "Real integrations are required in production. Missing: SENTRY_DSN…"
 * error the deployed container raises; referencing it (as route composition and
 * `next build` page collection do) must not.
 */
function productionReporterThunkWithoutSentry(): () => ErrorReporter {
  const environment = parseEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    APP_ORIGIN: "https://app.example.test",
    CLOUDINARY_CLOUD_NAME: "demo-cloud",
    CLOUDINARY_API_KEY: "fake-cloudinary-key",
    CLOUDINARY_API_SECRET: "fake-cloudinary-secret",
    CLOUDINARY_FOLDER_PREFIX: "prod",
    RESEND_API_KEY: "re_fake_key",
    EMAIL_FROM: "no-reply@example.test",
    INQUIRY_NOTIFICATION_FALLBACK: "fallback@example.test",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token",
    RATE_LIMIT_NAMESPACE: "prod:",
    // SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN / SENTRY_ENVIRONMENT deliberately absent.
  });
  const container = createIntegrationContainer(environment);
  return () => container.errorReporter;
}

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const SUBMISSION = {
  reference: "CRR-ABCDEFGH",
  createdAt: "2026-08-14T01:00:00.000Z",
  customerName: "Asha Mrema",
  customerPhone: "+255712345678",
  customerEmail: null,
  message: null,
  subject: {
    vehicleId: VEHICLE_ID,
    slug: "toyota-prado",
    brandName: "Toyota",
    model: "Prado",
    year: 2025,
    salePrice: 145_000_000,
    driverOption: "without_driver" as const,
  },
};

function request(body: unknown) {
  return new Request("http://localhost:3000/api/inquiries/purchase", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

function harness(
  options: {
    limiterResult?: { allowed: boolean; retryAfterMs?: number };
    submit?: ReturnType<typeof vi.fn>;
    send?: ReturnType<typeof vi.fn>;
    errorReporter?: () => ErrorReporter;
    reporterReports?: InMemoryErrorReporter;
  } = {},
) {
  const events: string[] = [];
  const tasks: Array<() => void | Promise<void>> = [];
  const check = vi.fn().mockImplementation(async () => {
    events.push("limit");
    return {
      allowed: options.limiterResult?.allowed ?? true,
      limit: 10,
      remaining: 9,
      resetAt: Date.now() + 1000,
      ...(options.limiterResult?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.limiterResult.retryAfterMs }),
    };
  });
  const submit =
    options.submit ??
    vi.fn().mockImplementation(async () => {
      events.push("persist");
      return SUBMISSION;
    });
  const send =
    options.send ??
    vi.fn().mockImplementation(async () => {
      events.push("notify");
      return { accepted: true, externalId: "email-id" };
    });
  const reporter = options.reporterReports ?? new InMemoryErrorReporter();
  const errorReporter = options.errorReporter ?? (() => reporter);
  const handler = createPurchaseInquiryPost({
    inquiryService: {
      submitPurchaseInquiry: submit,
      listAdmin: vi.fn(),
    } as InquiryService,
    settingsRepository: {
      findSingleton: vi.fn().mockResolvedValue({
        whatsappNumber: "+255712345678",
        inquiryNotificationEmails: ["inquiries@example.test"],
      }),
      updateSingleton: vi.fn(),
    } as never,
    rateLimiter: { check },
    emailSender: { send: send as never },
    errorReporter,
    hashSecret: "a-safe-test-secret-that-is-at-least-32-characters",
    publicOrigin: "https://example.test",
    allowedOrigin: "http://localhost:3000",
    scheduleAfter: (task) => {
      events.push("scheduled");
      tasks.push(task);
    },
  });
  return { handler, check, submit, send, events, tasks, reporter };
}

const VALID = {
  vehicleId: VEHICLE_ID,
  customerName: "Asha Mrema",
  customerPhone: "0712345678",
};

describe("POST /api/inquiries/purchase", () => {
  it("validates before limiter and persistence", async () => {
    const test = harness();
    const response = await test.handler(
      request({ ...VALID, reference: "CRR-ATTACKER" }),
      undefined as never,
    );
    expect(response.status).toBe(422);
    expect(test.check).not.toHaveBeenCalled();
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.tasks).toHaveLength(0);
  });

  it("rate limits both axes before persistence and never notifies", async () => {
    const test = harness({
      limiterResult: { allowed: false, retryAfterMs: 5000 },
    });
    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(429);
    expect(test.check).toHaveBeenCalledTimes(2);
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.tasks).toHaveLength(0);
  });

  it("returns 201 after persistence and schedules notification exactly once", async () => {
    const test = harness();
    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      reference: "CRR-ABCDEFGH",
      message: "Your purchase request has been saved.",
      whatsappUrl: expect.stringMatching(
        /^https:\/\/wa\.me\/255712345678\?text=/,
      ),
    });
    expect(test.events).toEqual(["limit", "limit", "persist", "scheduled"]);
    expect(test.send).not.toHaveBeenCalled();
    expect(test.tasks).toHaveLength(1);
    await test.tasks[0]?.();
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it("does not schedule notification when persistence fails", async () => {
    const test = harness({
      submit: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(500);
    expect(test.tasks).toHaveLength(0);
  });

  it("does not await email delivery before returning the saved response", async () => {
    const test = harness({
      send: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    });
    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(201);
    expect(test.send).not.toHaveBeenCalled();
  });
});

describe("POST /api/inquiries/purchase — lazy Sentry resolution", () => {
  it("verifies the production shape genuinely lacks Sentry", () => {
    // Guards the regression: the thunk backing the tests below really does throw
    // the exact Vercel Production build error when invoked.
    const thunk = productionReporterThunkWithoutSentry();
    expect(thunk).toThrow(
      "Real integrations are required in production. Missing: SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_ENVIRONMENT.",
    );
  });

  it("constructs the route in a production-shaped, Sentry-absent env without throwing and without accessing errorReporter", () => {
    // This is exactly what importing the route module / `next build` page
    // collection does: it constructs the handler. It must not resolve Sentry.
    const thunk = vi.fn(productionReporterThunkWithoutSentry());
    expect(() =>
      createPurchaseInquiryPost({
        inquiryService: { submitPurchaseInquiry: vi.fn() } as never,
        settingsRepository: { findSingleton: vi.fn() } as never,
        rateLimiter: { check: vi.fn() } as never,
        emailSender: { send: vi.fn() } as never,
        errorReporter: thunk,
        hashSecret: "a-safe-test-secret-that-is-at-least-32-characters",
        publicOrigin: "https://example.test",
        allowedOrigin: "http://localhost:3000",
        scheduleAfter: vi.fn(),
      }),
    ).not.toThrow();
    expect(thunk).not.toHaveBeenCalled();
  });

  it("resolves the reporter lazily at request-time and reports unexpected errors with safe context", async () => {
    const reporter = new InMemoryErrorReporter();
    const thunk = vi.fn(() => reporter as ErrorReporter);
    const test = harness({
      submit: vi.fn().mockRejectedValue(new Error("database boom")),
      errorReporter: thunk,
    });
    // Not touched until a request arrives.
    expect(thunk).not.toHaveBeenCalled();

    const response = await test.handler(request(VALID), undefined as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong",
        details: {},
        correlationId: expect.any(String),
      },
    });
    expect(thunk).toHaveBeenCalled();
    const reports = reporter.getReports();
    const captured = reports.find((r) => r.type === "exception");
    expect(captured).toBeDefined();
    // Safe context only: correlation + method + route, never request PII.
    expect(captured?.context).toMatchObject({
      correlationId: expect.any(String),
      method: "POST",
      route: "/api/inquiries/purchase",
    });
    expect(JSON.stringify(reports)).not.toContain("+255712345678");
  });

  it("falls back to the no-op reporter and preserves the 500 envelope when reporter resolution fails", async () => {
    const thunk = vi.fn(productionReporterThunkWithoutSentry());
    const test = harness({
      submit: vi.fn().mockRejectedValue(new Error("database boom")),
      errorReporter: thunk,
    });

    const response = await test.handler(request(VALID), undefined as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    // Resolution was attempted request-time (and safely swallowed).
    expect(thunk).toHaveBeenCalled();
  });

  it("returns 201 and no-ops notification reporting when Sentry is unavailable", async () => {
    const thunk = vi.fn(productionReporterThunkWithoutSentry());
    const test = harness({
      send: vi.fn().mockResolvedValue({ accepted: false }),
      errorReporter: thunk,
    });

    const response = await test.handler(request(VALID), undefined as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      reference: "CRR-ABCDEFGH",
    });
    expect(test.tasks).toHaveLength(1);
    // The post-response notification runs safely with no reporter available.
    await expect(test.tasks[0]?.()).resolves.toBeUndefined();
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it("keeps the 201 unchanged and reports notification failure with only safe reference/correlation context", async () => {
    const reporter = new InMemoryErrorReporter();
    const test = harness({
      send: vi.fn().mockResolvedValue({ accepted: false }),
      reporterReports: reporter,
    });

    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(201);
    const bodyBefore = await response.clone().json();

    await test.tasks[0]?.();

    // The already-constructed response is untouched by the notification path.
    await expect(response.json()).resolves.toEqual(bodyBefore);

    const messages = reporter.getReports().filter((r) => r.type === "message");
    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message).toMatchObject({
      type: "message",
      message: "Purchase inquiry notification failed.",
      level: "error",
      context: {
        correlationId: expect.any(String),
        additional: {
          operation: "purchase-inquiry-notification",
          inquiryReference: "CRR-ABCDEFGH",
        },
      },
    });
  });

  it("never reports customer, snapshot, provider, or secret data on notification failure", async () => {
    const reporter = new InMemoryErrorReporter();
    const richSubmission = {
      ...SUBMISSION,
      customerEmail: "asha.private@example.test",
      message: "Please phone me about the Prado at lunchtime",
    };
    const test = harness({
      submit: vi.fn().mockResolvedValue(richSubmission),
      send: vi.fn().mockResolvedValue({ accepted: false }),
      reporterReports: reporter,
    });

    const response = await test.handler(request(VALID), undefined as never);
    expect(response.status).toBe(201);
    await test.tasks[0]?.();

    const serialized = JSON.stringify(reporter.getReports());
    for (const forbidden of [
      "asha.private@example.test", // customer email
      "Please phone me about the Prado at lunchtime", // customer message
      "+255712345678", // customer phone / whatsapp number
      "255712345678", // whatsapp digits
      "Asha Mrema", // customer name
      "145000000", // sale-price snapshot
      "wa.me", // provider (WhatsApp) URL
      "a-safe-test-secret-that-is-at-least-32-characters", // hash secret
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The safe, non-identifying reference is still present for correlation.
    expect(serialized).toContain("CRR-ABCDEFGH");
  });
});
