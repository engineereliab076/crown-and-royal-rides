import { after } from "next/server";

import { getInquiryRuntimeServices } from "@/server/inquiries/services";
import { createPurchaseInquiryPost } from "@/server/modules/inquiries/purchase-route";

export const POST = createPurchaseInquiryPost({
  get inquiryService() {
    return getInquiryRuntimeServices().inquiryService;
  },
  get settingsRepository() {
    return getInquiryRuntimeServices().settingsRepository;
  },
  get rateLimiter() {
    return getInquiryRuntimeServices().integrations.rateLimiter;
  },
  get emailSender() {
    return getInquiryRuntimeServices().integrations.emailSender;
  },
  get errorReporter() {
    return getInquiryRuntimeServices().integrations.errorReporter;
  },
  get hashSecret() {
    return getInquiryRuntimeServices().hashSecret;
  },
  get publicOrigin() {
    return getInquiryRuntimeServices().publicOrigin;
  },
  get allowedOrigin() {
    return getInquiryRuntimeServices().publicOrigin;
  },
  scheduleAfter: after,
});
