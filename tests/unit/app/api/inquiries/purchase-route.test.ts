import { describe, expect, it, vi } from "vitest";

import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import type { InquiryService } from "@/server/modules/inquiries/service";

import { createPurchaseInquiryPost } from "@/server/modules/inquiries/purchase-route";

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
    errorReporter: new InMemoryErrorReporter(),
    hashSecret: "a-safe-test-secret-that-is-at-least-32-characters",
    publicOrigin: "https://example.test",
    allowedOrigin: "http://localhost:3000",
    scheduleAfter: (task) => {
      events.push("scheduled");
      tasks.push(task);
    },
  });
  return { handler, check, submit, send, events, tasks };
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
