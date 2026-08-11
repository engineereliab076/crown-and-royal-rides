import type {
  EmailMessage,
  SendOutcome,
} from "@/server/integrations/email-sender/types";

/**
 * Invalid caller input throws. Operational delivery failures are returned as a
 * failed outcome so callers can apply business-specific retry behavior.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<SendOutcome>;
}
