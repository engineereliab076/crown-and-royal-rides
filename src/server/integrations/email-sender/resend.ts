import "server-only";

import { Resend } from "resend";

import type { EmailSender } from "@/server/integrations/email-sender/interface";
import type {
  EmailMessage,
  SendOutcome,
} from "@/server/integrations/email-sender/types";
import { normalizeEmailMessage } from "@/server/integrations/email-sender/validation";

export interface ResendEmailSenderConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo?: string;
}

export interface ResendSendInput {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
  readonly tags?: readonly Readonly<{ name: string; value: string }>[];
  readonly replyTo?: string;
}

export interface ResendSendResponse {
  readonly data: Readonly<{ id: string }> | null;
  readonly error: unknown | null;
}

export interface ResendFacade {
  send(input: ResendSendInput): Promise<ResendSendResponse>;
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function createResendFacade(apiKey: string): ResendFacade {
  const resend = new Resend(apiKey);
  return {
    async send(input): Promise<ResendSendResponse> {
      const base = {
        from: input.from,
        to: [...input.to],
        subject: input.subject,
        ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
        ...(input.tags === undefined
          ? {}
          : { tags: input.tags.map((tag) => ({ ...tag })) }),
      };
      if (input.html !== undefined) {
        return resend.emails.send({
          ...base,
          html: input.html,
          ...(input.text === undefined ? {} : { text: input.text }),
        });
      }
      if (input.text !== undefined) {
        return resend.emails.send({ ...base, text: input.text });
      }
      return { data: null, error: { name: "invalid_input" } };
    },
  };
}

const FAILED_OUTCOME: SendOutcome = Object.freeze({
  accepted: false,
  code: "EMAIL_PROVIDER_UNAVAILABLE",
  reason: "Email could not be accepted for delivery.",
});

export class ResendEmailSender implements EmailSender {
  readonly #from: string;
  readonly #replyTo: string | undefined;
  readonly #client: ResendFacade;

  constructor(config: ResendEmailSenderConfig, client?: ResendFacade) {
    if (typeof config !== "object" || config === null) {
      throw new TypeError("Resend configuration must be an object.");
    }
    const apiKey = required(config.apiKey, "Resend apiKey");
    this.#from = required(config.from, "Resend from");
    this.#replyTo =
      config.replyTo === undefined
        ? undefined
        : required(config.replyTo, "Resend replyTo");
    this.#client = client ?? createResendFacade(apiKey);
  }

  async send(message: EmailMessage): Promise<SendOutcome> {
    const normalized = normalizeEmailMessage(message);
    const input: ResendSendInput = Object.freeze({
      from: this.#from,
      to: Object.freeze([...normalized.to]),
      subject: normalized.subject,
      ...(normalized.html === undefined ? {} : { html: normalized.html }),
      ...(normalized.text === undefined ? {} : { text: normalized.text }),
      ...(normalized.tags === undefined
        ? {}
        : {
            tags: Object.freeze(
              normalized.tags.map((tag) => Object.freeze({ ...tag })),
            ),
          }),
      ...(this.#replyTo === undefined ? {} : { replyTo: this.#replyTo }),
    });

    try {
      const response = await this.#client.send(input);
      if (
        response.error !== null ||
        response.data === null ||
        typeof response.data?.id !== "string" ||
        response.data.id.trim().length === 0
      ) {
        return FAILED_OUTCOME;
      }

      return Object.freeze({
        accepted: true,
        externalId: response.data.id.trim(),
      });
    } catch {
      return FAILED_OUTCOME;
    }
  }
}
