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

/**
 * Emit at most one safe, PII-free diagnostic for a failed *post-commit* handoff
 * step. Reporting is fully guarded: a missing or throwing reporter can never
 * propagate, so this can be called from any post-commit path without risking the
 * committed 201. The context carries only the correlation id and the opaque
 * inquiry reference — never customer, snapshot, or provider data.
 */
async function reportPurchaseHandoffFailure(
  reporter: ErrorReporter,
  correlationId: string,
  reference: string,
  stage: "settings-lookup" | "notification-schedule",
): Promise<void> {
  try {
    await reporter.captureMessage(
      "Purchase inquiry post-commit handoff step failed.",
      "warning",
      {
        correlationId,
        additional: {
          operation: "purchase-inquiry-handoff",
          stage,
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
        // Missing settings return null (handled above); a genuine load failure
        // lands here. The inquiry stays committed, the WhatsApp handoff is
        // absent, and recipients stay empty so no email is attempted.
        await reportPurchaseHandoffFailure(
          errorReporter,
          execution.correlationId,
          submission.reference,
          "settings-lookup",
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

      // The inquiry is already committed and the 201 is constructed. Scheduling
      // optional post-response work must never replace that response: if the
      // scheduler (`after()`) throws, the committed inquiry would otherwise
      // surface a false 500. Guard it so no post-commit operation escapes.
      try {
        schedulePurchaseInquiryNotification({
          scheduleAfter: dependencies.scheduleAfter,
          emailSender: dependencies.emailSender,
          errorReporter,
          recipients,
          submission,
          correlationId: execution.correlationId,
        });
      } catch {
        await reportPurchaseHandoffFailure(
          errorReporter,
          execution.correlationId,
          submission.reference,
          "notification-schedule",
        );
      }
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
