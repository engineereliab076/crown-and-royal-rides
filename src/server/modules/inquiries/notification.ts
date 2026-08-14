import "server-only";

import { formatTzs } from "@/lib/money";
import type { EmailSender } from "@/server/integrations/email-sender/interface";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type { PurchaseInquirySubmission } from "@/server/modules/inquiries/service";

export const INQUIRY_NOTIFICATION_TIMEOUT_MS = 2500;

export type AfterScheduler = (task: () => void | Promise<void>) => void;

function notificationText(submission: PurchaseInquirySubmission): string {
  const subject = submission.subject;
  return [
    `Purchase inquiry ${submission.reference}`,
    `Created: ${submission.createdAt}`,
    `Customer: ${submission.customerName}`,
    `Phone: ${submission.customerPhone}`,
    ...(submission.customerEmail === null
      ? []
      : [`Email: ${submission.customerEmail}`]),
    `Vehicle: ${subject.year} ${subject.brandName} ${subject.model}`,
    `Price: ${formatTzs(subject.salePrice)}`,
    `Driver option: ${subject.driverOption}`,
    ...(submission.message === null ? [] : [`Message: ${submission.message}`]),
  ].join("\n");
}

async function safelyReportFailure(input: {
  readonly reporter: ErrorReporter;
  readonly correlationId: string;
  readonly reference: string;
  readonly stage: string;
}): Promise<void> {
  try {
    await input.reporter.captureMessage(
      "Purchase inquiry notification failed.",
      "error",
      {
        correlationId: input.correlationId,
        additional: {
          operation: "purchase-inquiry-notification",
          stage: input.stage,
          inquiryReference: input.reference,
        },
      },
    );
  } catch {}
}

export async function deliverPurchaseInquiryNotification(input: {
  readonly emailSender: EmailSender;
  readonly errorReporter: ErrorReporter;
  readonly recipients: readonly string[];
  readonly submission: PurchaseInquirySubmission;
  readonly correlationId: string;
  readonly timeoutMs?: number;
}): Promise<void> {
  if (input.recipients.length === 0) return;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("notification timeout")),
      input.timeoutMs ?? INQUIRY_NOTIFICATION_TIMEOUT_MS,
    );
  });

  try {
    const outcome = await Promise.race([
      input.emailSender.send({
        to: input.recipients,
        subject: `Purchase inquiry ${input.submission.reference}`,
        text: notificationText(input.submission),
        tags: [{ name: "operation", value: "purchase-inquiry" }],
      }),
      timeout,
    ]);
    if (!outcome.accepted) {
      await safelyReportFailure({
        reporter: input.errorReporter,
        correlationId: input.correlationId,
        reference: input.submission.reference,
        stage: "delivery-rejected",
      });
    }
  } catch {
    await safelyReportFailure({
      reporter: input.errorReporter,
      correlationId: input.correlationId,
      reference: input.submission.reference,
      stage: "delivery-error",
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function schedulePurchaseInquiryNotification(input: {
  readonly scheduleAfter: AfterScheduler;
  readonly emailSender: EmailSender;
  readonly errorReporter: ErrorReporter;
  readonly recipients: readonly string[];
  readonly submission: PurchaseInquirySubmission;
  readonly correlationId: string;
  readonly timeoutMs?: number;
}): void {
  input.scheduleAfter(() =>
    deliverPurchaseInquiryNotification({
      emailSender: input.emailSender,
      errorReporter: input.errorReporter,
      recipients: input.recipients,
      submission: input.submission,
      correlationId: input.correlationId,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    }),
  );
}
