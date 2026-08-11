import { describe, expect, it } from "vitest";

import type { EmailSender } from "@/server/integrations/email-sender/interface";

export function runEmailSenderContract(
  name: string,
  createSender: () => EmailSender,
): void {
  describe(`${name} EmailSender contract`, () => {
    it("accepts a message with multiple recipients and a text body", async () => {
      const outcome = await createSender().send({
        to: ["admin-one@example.test", "admin-two@example.test"],
        subject: "New inquiry",
        text: "A fake inquiry is ready for review.",
        tags: [{ name: "kind", value: "inquiry" }],
      });

      expect(outcome.accepted).toBe(true);
      if (outcome.accepted) expect(outcome.externalId).not.toHaveLength(0);
    });

    it("accepts an HTML-only message", async () => {
      await expect(
        createSender().send({
          to: ["admin@example.test"],
          subject: "Vehicle update",
          html: "<p>A fake vehicle changed.</p>",
        }),
      ).resolves.toMatchObject({ accepted: true });
    });

    it.each([
      ["no recipients", { to: [], subject: "Subject", text: "Body" }],
      ["blank recipient", { to: ["  "], subject: "Subject", text: "Body" }],
      ["blank subject", { to: ["a@example.test"], subject: " ", text: "Body" }],
      ["no usable body", { to: ["a@example.test"], subject: "Subject" }],
    ])("rejects %s", async (_description, message) => {
      await expect(createSender().send(message)).rejects.toThrow(TypeError);
    });

    it("rejects invalid tag names and blank values", async () => {
      const sender = createSender();
      await expect(
        sender.send({
          to: ["admin@example.test"],
          subject: "Subject",
          text: "Body",
          tags: [{ name: "provider tag", value: "ok" }],
        }),
      ).rejects.toThrow(TypeError);
      await expect(
        sender.send({
          to: ["admin@example.test"],
          subject: "Subject",
          text: "Body",
          tags: [{ name: "kind", value: " " }],
        }),
      ).rejects.toThrow(TypeError);
    });
  });
}
