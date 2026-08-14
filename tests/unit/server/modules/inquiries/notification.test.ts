import { describe, expect, it, vi } from "vitest";

import { InMemoryEmailSender } from "@/server/integrations/email-sender/in-memory";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import {
  deliverPurchaseInquiryNotification,
  schedulePurchaseInquiryNotification,
} from "@/server/modules/inquiries/notification";
import type { PurchaseInquirySubmission } from "@/server/modules/inquiries/service";

const SUBMISSION: PurchaseInquirySubmission = {
  reference: "CRR-ABCDEFGH",
  createdAt: "2026-08-14T01:00:00.000Z",
  customerName: "Asha Mrema",
  customerPhone: "+255712345678",
  customerEmail: "asha@example.test",
  message: "Please call.",
  subject: {
    vehicleId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    slug: "toyota-prado",
    brandName: "Toyota",
    model: "Prado",
    year: 2025,
    salePrice: 145_000_000,
    driverOption: "without_driver",
  },
};

describe("purchase inquiry notification", () => {
  it("skips empty recipients safely", async () => {
    const emailSender = new InMemoryEmailSender();
    await deliverPurchaseInquiryNotification({
      emailSender,
      errorReporter: new InMemoryErrorReporter(),
      recipients: [],
      submission: SUBMISSION,
      correlationId: "correlation",
    });
    expect(emailSender.getSentMessages()).toHaveLength(0);
  });

  it("registers exactly one post-response task", async () => {
    const tasks: Array<() => void | Promise<void>> = [];
    const emailSender = new InMemoryEmailSender();
    schedulePurchaseInquiryNotification({
      scheduleAfter: (task) => tasks.push(task),
      emailSender,
      errorReporter: new InMemoryErrorReporter(),
      recipients: ["inquiries@example.test"],
      submission: SUBMISSION,
      correlationId: "correlation",
    });
    expect(tasks).toHaveLength(1);
    expect(emailSender.getSentMessages()).toHaveLength(0);
    await tasks[0]?.();
    expect(emailSender.getSentMessages()).toHaveLength(1);
  });

  it("reports rejected and throwing delivery without exposing customer data", async () => {
    const reporter = new InMemoryErrorReporter();
    await deliverPurchaseInquiryNotification({
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider body")),
      },
      errorReporter: reporter,
      recipients: ["inquiries@example.test"],
      submission: SUBMISSION,
      correlationId: "correlation",
      timeoutMs: 20,
    });
    const reports = JSON.stringify(reporter.getReports());
    expect(reports).toContain("CRR-ABCDEFGH");
    expect(reports).not.toContain("Asha");
    expect(reports).not.toContain("255712345678");
    expect(reports).not.toContain("provider body");
  });
});
