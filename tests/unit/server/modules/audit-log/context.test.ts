import { describe, expect, it } from "vitest";

import { createAuditContext } from "@/server/modules/audit-log/context";

describe("audit request context", () => {
  it("HMAC-hashes the client IP and preserves only the correlation ID", () => {
    const context = createAuditContext({
      correlationId: "correlation-123",
      clientIp: "203.0.113.42",
      hashSecret: "a-secure-test-secret-at-least-32-characters",
    });
    expect(context.correlationId).toBe("correlation-123");
    expect(context.ipHash).not.toContain("203.0.113.42");
    expect(context.ipHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses a non-identifying sentinel when the client IP is unavailable", () => {
    const context = createAuditContext({
      correlationId: "correlation-123",
      clientIp: null,
      hashSecret: "a-secure-test-secret-at-least-32-characters",
    });
    expect(context.ipHash).toHaveLength(43);
  });
});
