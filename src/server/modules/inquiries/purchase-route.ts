import "server-only";

import { buildPurchaseWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { parseApiInput, readJsonBody } from "@/server/http/admin-api";
import { getClientIp } from "@/server/http/client-ip";
import { resolveErrorReporter, withRouteHandler } from "@/server/http/handler";
import type { EmailSender } from "@/server/integrations/email-sender/interface";
import type { ErrorReporter } from "@/server/integrations/error-reporter/interface";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";
import {
  schedulePurchaseInquiryNotification,
  type AfterScheduler,
} from "@/server/modules/inquiries/notification";
import { enforcePurchaseInquiryRateLimit } from "@/server/modules/inquiries/rate-limit";
import { purchaseInquirySchema } from "@/server/modules/inquiries/schemas";
import type { InquiryService } from "@/server/modules/inquiries/service";
import type { SettingsRepository } from "@/server/modules/settings/repository";

export interface PurchaseRouteDependencies {
  readonly inquiryService: InquiryService;
  readonly settingsRepository: SettingsRepository;
  readonly rateLimiter: RateLimiter;
  readonly emailSender: EmailSender;
  /**
   * A thunk resolving the error reporter. It is invoked request-time only —
   * never at route-module import or build-time page collection — so importing
   * this route constructs no Sentry adapter and requires no Sentry variables.
   * Resolution is funnelled through `resolveErrorReporter`, so a thunk that
   * throws (e.g. Sentry absent in a deployed environment) safely degrades to the
   * no-op reporter.
   */
  readonly errorReporter: () => ErrorReporter;
  readonly hashSecret: string;
  readonly publicOrigin: string;
  readonly allowedOrigin: string;
  readonly scheduleAfter: AfterScheduler;
}

function publicJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function reportSettingsFailure(
  reporter: ErrorReporter,
  correlationId: string,
  reference: string,
): Promise<void> {
  try {
    await reporter.captureMessage(
      "Purchase inquiry settings lookup failed.",
      "warning",
      {
        correlationId,
        additional: {
          operation: "purchase-inquiry-handoff",
          stage: "settings-lookup",
          inquiryReference: reference,
        },
      },
    );
  } catch {}
}

export function createPurchaseInquiryPost(
  dependencies: PurchaseRouteDependencies,
) {
  return withRouteHandler(
    async (request, _context, execution) => {
      const body = parseApiInput(
        purchaseInquirySchema,
        await readJsonBody(request),
        "Invalid purchase request.",
      );
      const clientIp = getClientIp(request.headers);
      // Resolve the reporter once, request-time and safely: the thunk is never
      // invoked at import, and a resolution failure degrades to the no-op
      // reporter so no request-time reporting path can throw.
      const errorReporter = resolveErrorReporter(dependencies.errorReporter);
      await enforcePurchaseInquiryRateLimit({
        rateLimiter: dependencies.rateLimiter,
        errorReporter,
        hashSecret: dependencies.hashSecret,
        correlationId: execution.correlationId,
        clientIp,
        normalizedPhone: body.customerPhone,
      });

      const submission =
        await dependencies.inquiryService.submitPurchaseInquiry(body, {
          correlationId: execution.correlationId,
        });

      let recipients: readonly string[] = [];
      let whatsappUrl: string | null = null;
      try {
        const settings = await dependencies.settingsRepository.findSingleton();
        if (settings !== null) {
          recipients = [...settings.inquiryNotificationEmails];
          try {
            const vehicleUrl = new URL(
              `/cars/${submission.subject.slug}`,
              dependencies.publicOrigin,
            ).toString();
            whatsappUrl = buildWhatsAppUrl(
              settings.whatsappNumber,
              buildPurchaseWhatsAppMessage({
                reference: submission.reference,
                brandName: submission.subject.brandName,
                model: submission.subject.model,
                year: submission.subject.year,
                salePrice: submission.subject.salePrice,
                vehicleUrl,
              }),
            );
          } catch {
            whatsappUrl = null;
          }
        }
      } catch {
        await reportSettingsFailure(
          errorReporter,
          execution.correlationId,
          submission.reference,
        );
      }

      const response = publicJson(
        {
          reference: submission.reference,
          message: "Your purchase request has been saved.",
          whatsappUrl,
        },
        { status: 201 },
      );

      schedulePurchaseInquiryNotification({
        scheduleAfter: dependencies.scheduleAfter,
        emailSender: dependencies.emailSender,
        errorReporter,
        recipients,
        submission,
        correlationId: execution.correlationId,
      });
      return response;
    },
    {
      origin: { mode: "required", allowedOrigin: dependencies.allowedOrigin },
      // Pass the thunk (not the resolved reporter): the handler resolves it
      // lazily and safely only on an unexpected error, never at import.
      errorReporter: dependencies.errorReporter,
    },
  );
}
