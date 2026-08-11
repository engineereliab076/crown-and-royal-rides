import type { EmailSender } from "@/server/integrations/email-sender/interface";
import type {
  EmailFailure,
  EmailMessage,
  SendOutcome,
} from "@/server/integrations/email-sender/types";
import { normalizeEmailMessage } from "@/server/integrations/email-sender/validation";

export interface SentEmail {
  readonly externalId: string;
  readonly message: EmailMessage;
}

const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function copyFailure(failure: EmailFailure): EmailFailure {
  if (typeof failure !== "object" || failure === null) {
    throw new TypeError("Email failure must be an object.");
  }

  const code = nonEmpty(failure.code, "Email failure code");
  if (!FAILURE_CODE_PATTERN.test(code)) {
    throw new TypeError(
      "Email failure code must use uppercase letters, digits, and underscores.",
    );
  }

  return Object.freeze({
    code,
    reason: nonEmpty(failure.reason, "Email failure reason"),
  });
}

function copySentEmail(email: SentEmail): SentEmail {
  return Object.freeze({
    externalId: email.externalId,
    message: normalizeEmailMessage(email.message),
  });
}

export class InMemoryEmailSender implements EmailSender {
  readonly #sent: SentEmail[] = [];
  #nextExternalId = 1;
  #nextFailure: EmailFailure | undefined;

  async send(message: EmailMessage): Promise<SendOutcome> {
    const copiedMessage = normalizeEmailMessage(message);
    const failure = this.#nextFailure;
    this.#nextFailure = undefined;

    if (failure !== undefined) {
      return Object.freeze({
        accepted: false,
        code: failure.code,
        reason: failure.reason,
      });
    }

    const externalId = `test-email-${this.#nextExternalId++}`;
    this.#sent.push(Object.freeze({ externalId, message: copiedMessage }));
    return Object.freeze({ accepted: true, externalId });
  }

  failNext(failure: EmailFailure): void {
    this.#nextFailure = copyFailure(failure);
  }

  getSentMessages(): ReadonlyArray<SentEmail> {
    return Object.freeze(this.#sent.map(copySentEmail));
  }

  reset(): void {
    this.#sent.length = 0;
    this.#nextExternalId = 1;
    this.#nextFailure = undefined;
  }
}
