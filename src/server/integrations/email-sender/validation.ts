import type {
  EmailMessage,
  EmailTag,
} from "@/server/integrations/email-sender/types";

const TAG_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function copyTags(tags: readonly EmailTag[] | undefined): readonly EmailTag[] {
  return Object.freeze(
    (tags ?? []).map((tag) => {
      if (typeof tag !== "object" || tag === null) {
        throw new TypeError("Email tags must be objects.");
      }

      const name = nonEmpty(tag.name, "Email tag name");
      if (!TAG_NAME_PATTERN.test(name)) {
        throw new TypeError(
          "Email tag names may contain only letters, digits, underscores, and hyphens.",
        );
      }

      return Object.freeze({
        name,
        value: nonEmpty(tag.value, "Email tag value"),
      });
    }),
  );
}

export function normalizeEmailMessage(message: EmailMessage): EmailMessage {
  if (typeof message !== "object" || message === null) {
    throw new TypeError("Email message must be an object.");
  }
  if (!Array.isArray(message.to) || message.to.length === 0) {
    throw new TypeError("Email message must have at least one recipient.");
  }

  const to = Object.freeze(
    message.to.map((recipient) => nonEmpty(recipient, "Email recipient")),
  );
  const subject = nonEmpty(message.subject, "Email subject");
  const html = message.html?.trim();
  const text = message.text?.trim();

  if ((html?.length ?? 0) === 0 && (text?.length ?? 0) === 0) {
    throw new TypeError("Email message must have an HTML or text body.");
  }

  return Object.freeze({
    to,
    subject,
    ...(html === undefined || html.length === 0 ? {} : { html }),
    ...(text === undefined || text.length === 0 ? {} : { text }),
    tags: copyTags(message.tags),
  });
}
