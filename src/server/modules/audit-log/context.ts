import "server-only";

import { createHmac } from "node:crypto";

export interface AuditContext {
  readonly correlationId: string;
  readonly ipHash: string;
}

/** Hash an IP (or a fixed unknown sentinel) before it reaches persistence. */
export function createAuditContext(input: {
  readonly correlationId: string;
  readonly clientIp: string | null;
  readonly hashSecret: string;
}): AuditContext {
  if (input.hashSecret.length === 0) {
    throw new TypeError("Audit context requires a hash secret.");
  }
  const identifier = input.clientIp ?? "unknown-client-ip";
  return {
    correlationId: input.correlationId,
    ipHash: createHmac("sha256", input.hashSecret)
      .update(identifier)
      .digest("base64url"),
  };
}
