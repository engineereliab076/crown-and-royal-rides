import { describe, expect, it, vi } from "vitest";

import {
  ResendEmailSender,
  type ResendFacade,
} from "@/server/integrations/email-sender/resend";
import type { EmailMessage } from "@/server/integrations/email-sender/types";
import { runEmailSenderContract } from "./contract";

function successfulClient(): ResendFacade {
  return {
    send: vi.fn(async () => ({ data: { id: "email-123" }, error: null })),
  };
}

function createSender(client: ResendFacade = successfulClient()) {
  return new ResendEmailSender(
    {
      apiKey: "re_fake_key",
      from: "no-reply@example.test",
      replyTo: "reply@example.test",
    },
    client,
  );
}

runEmailSenderContract("ResendEmailSender", () => createSender());

describe("ResendEmailSender provider mapping", () => {
  it("maps one normalized message and preserves caller immutability", async () => {
    const send = vi.fn<ResendFacade["send"]>(async () => ({
      data: { id: "email-456" },
      error: null,
    }));
    const recipients = [" admin@example.test "];
    const tags = [{ name: "kind", value: "inquiry" }];
    const message: EmailMessage = {
      to: recipients,
      subject: " New inquiry ",
      html: " <p>Fake content</p> ",
      text: " Fake content ",
      tags,
    };

    await expect(createSender({ send }).send(message)).resolves.toEqual({
      accepted: true,
      externalId: "email-456",
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      from: "no-reply@example.test",
      replyTo: "reply@example.test",
      to: ["admin@example.test"],
      subject: "New inquiry",
      html: "<p>Fake content</p>",
      text: "Fake content",
      tags: [{ name: "kind", value: "inquiry" }],
    });
    expect(recipients).toEqual([" admin@example.test "]);
    expect(tags).toEqual([{ name: "kind", value: "inquiry" }]);
  });

  it("maps a provider-returned operational error safely", async () => {
    const marker = "RAW_RESEND_ERROR_MARKER";
    const sender = createSender({
      send: vi.fn(async () => ({
        data: null,
        error: { message: marker, statusCode: 503 },
      })),
    });

    const result = await sender.send({
      to: ["admin@example.test"],
      subject: "Subject",
      text: "Body",
    });
    expect(result).toEqual({
      accepted: false,
      code: "EMAIL_PROVIDER_UNAVAILABLE",
      reason: "Email could not be accepted for delivery.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("maps rejected provider calls safely", async () => {
    const sender = createSender({
      send: vi.fn(async () => {
        throw new Error("RAW_THROWN_PROVIDER_MARKER");
      }),
    });
    const result = await sender.send({
      to: ["admin@example.test"],
      subject: "Subject",
      text: "Body",
    });
    expect(result).toMatchObject({
      accepted: false,
      code: "EMAIL_PROVIDER_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("RAW_THROWN_PROVIDER_MARKER");
  });

  it.each([
    { data: null, error: null },
    { data: { id: "" }, error: null },
    { data: { id: "email-123" }, error: { name: "unexpected" } },
  ])("rejects malformed provider response %#", async (response) => {
    const sender = createSender({ send: vi.fn(async () => response) });
    await expect(
      sender.send({
        to: ["admin@example.test"],
        subject: "Subject",
        text: "Body",
      }),
    ).resolves.toMatchObject({ accepted: false });
  });

  it("validates before calling the provider", async () => {
    const send = vi.fn<ResendFacade["send"]>();
    await expect(
      createSender({ send }).send({ to: [], subject: "Subject", text: "Body" }),
    ).rejects.toThrow(TypeError);
    expect(send).not.toHaveBeenCalled();
  });
});
