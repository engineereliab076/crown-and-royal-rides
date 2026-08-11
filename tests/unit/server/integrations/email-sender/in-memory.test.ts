import { describe, expect, it } from "vitest";

import { InMemoryEmailSender } from "@/server/integrations/email-sender/in-memory";
import type { EmailMessage } from "@/server/integrations/email-sender/types";
import { runEmailSenderContract } from "./contract";

runEmailSenderContract("InMemoryEmailSender", () => new InMemoryEmailSender());

function fakeMessage(): EmailMessage {
  return {
    to: ["admin@example.test"],
    subject: "New inquiry",
    html: "<p>Fake inquiry</p>",
    text: "Fake inquiry",
    tags: [{ name: "kind", value: "inquiry" }],
  };
}

describe("InMemoryEmailSender inspection behavior", () => {
  it("records copy-safe messages with deterministic IDs", async () => {
    const sender = new InMemoryEmailSender();

    await expect(sender.send(fakeMessage())).resolves.toEqual({
      accepted: true,
      externalId: "test-email-1",
    });
    await expect(sender.send(fakeMessage())).resolves.toEqual({
      accepted: true,
      externalId: "test-email-2",
    });

    const sent = sender.getSentMessages();
    expect(sent.map(({ externalId }) => externalId)).toEqual([
      "test-email-1",
      "test-email-2",
    ]);
    expect(Object.isFrozen(sent)).toBe(true);
    expect(Object.isFrozen(sent[0]?.message.to)).toBe(true);
    expect(Object.isFrozen(sent[0]?.message.tags?.[0])).toBe(true);
  });

  it("caller mutation after send does not alter recorded messages", async () => {
    const sender = new InMemoryEmailSender();
    const recipients = ["admin@example.test"];
    const tags = [{ name: "kind", value: "inquiry" }];
    const message = {
      to: recipients,
      subject: "New inquiry",
      text: "Fake inquiry",
      tags,
    };

    await sender.send(message);
    recipients[0] = "changed@example.test";
    tags[0] = { name: "changed", value: "changed" };
    message.subject = "Changed";

    expect(sender.getSentMessages()[0]?.message).toEqual({
      to: ["admin@example.test"],
      subject: "New inquiry",
      text: "Fake inquiry",
      tags: [{ name: "kind", value: "inquiry" }],
    });
  });

  it("returned snapshots cannot mutate internal history", async () => {
    const sender = new InMemoryEmailSender();
    await sender.send(fakeMessage());

    const first = sender.getSentMessages();
    expect(() =>
      Reflect.set(first[0]?.message ?? {}, "subject", "Changed"),
    ).not.toThrow();
    expect(sender.getSentMessages()[0]?.message.subject).toBe("New inquiry");
  });

  it("a configured operational failure affects only the next valid call", async () => {
    const sender = new InMemoryEmailSender();
    sender.failNext({
      code: "PROVIDER_UNAVAILABLE",
      reason: "Try again later",
    });

    await expect(sender.send(fakeMessage())).resolves.toEqual({
      accepted: false,
      code: "PROVIDER_UNAVAILABLE",
      reason: "Try again later",
    });
    await expect(sender.send(fakeMessage())).resolves.toEqual({
      accepted: true,
      externalId: "test-email-1",
    });
    expect(sender.getSentMessages()).toHaveLength(1);
  });

  it("invalid input does not consume a configured failure", async () => {
    const sender = new InMemoryEmailSender();
    sender.failNext({ code: "TEMPORARY_FAILURE", reason: "Retry safely" });

    await expect(
      sender.send({ to: [], subject: "Subject", text: "Body" }),
    ).rejects.toThrow(TypeError);
    await expect(sender.send(fakeMessage())).resolves.toMatchObject({
      accepted: false,
      code: "TEMPORARY_FAILURE",
    });
  });

  it("reset clears history, failure configuration, and ID state", async () => {
    const sender = new InMemoryEmailSender();
    await sender.send(fakeMessage());
    sender.failNext({ code: "TEMPORARY_FAILURE", reason: "Retry safely" });

    sender.reset();

    expect(sender.getSentMessages()).toEqual([]);
    await expect(sender.send(fakeMessage())).resolves.toEqual({
      accepted: true,
      externalId: "test-email-1",
    });
  });
});
